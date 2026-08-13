import {
  Agent,
  convertToLlm,
  createCompactionSummaryMessage,
  estimateContextTokens,
  estimateTokens,
  generateSummary,
  shouldCompact,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { ImageContent, Models } from "@earendil-works/pi-ai";

import {
  createModelCatalogFromModels,
  type ModelCatalog,
  type ModelSelection,
} from "../models/model-catalog";
import type { RuntimeSession } from "../session/session-repository";
import {
  defaultRuntimeTelemetry,
  type RuntimeTelemetryOptions,
} from "../telemetry/telemetry";
import type { TelemetrySpan } from "@earendil-works/pi-telemetry";

export type AgentRuntimeEvent =
  | { type: "run_started" }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "message_completed"; message: AgentMessage }
  | {
      type: "tool_started";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_updated";
      toolCallId: string;
      toolName: string;
      update: unknown;
    }
  | {
      type: "tool_pending";
      toolCallId: string;
      toolName: string;
      label: string;
      args: unknown;
    }
  | {
      type: "tool_finished";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "run_finished"; status: RuntimeRunResult["status"] };

export type RuntimeRunResult = {
  status: "completed" | "aborted" | "failed";
  message?: AgentMessage;
  error?: string;
};

export type CreateAgentRuntimeOptions = {
  session: RuntimeSession;
  models: Models | ModelCatalog;
  model: ModelSelection;
  systemPrompt: string;
  tools?: AgentTool[];
  telemetry?: RuntimeTelemetryOptions;
  compaction?: Partial<CompactionSettings>;
};

type RuntimeEventListener = (event: AgentRuntimeEvent) => void | Promise<void>;

function runStatus(message: AgentMessage | undefined): RuntimeRunResult {
  if (message?.role !== "assistant") return { status: "failed" };
  if (message.stopReason === "aborted") {
    return {
      status: "aborted",
      message,
      ...(message.errorMessage ? { error: message.errorMessage } : {}),
    };
  }
  if (message.stopReason === "error") {
    return {
      status: "failed",
      message,
      ...(message.errorMessage ? { error: message.errorMessage } : {}),
    };
  }
  return { status: "completed", message };
}

function lastAssistant(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message;
  }
  return undefined;
}

export class AgentRuntime {
  private readonly listeners = new Set<RuntimeEventListener>();
  private running = false;
  private abortRequested = false;
  private readonly telemetryContext;
  private readonly telemetryAttributes;

  constructor(
    private readonly agent: Agent,
    private readonly session: RuntimeSession,
    telemetry: RuntimeTelemetryOptions = defaultRuntimeTelemetry,
  ) {
    this.telemetryContext = telemetry.context ?? defaultRuntimeTelemetry.context;
    this.telemetryAttributes = telemetry.attributes ?? {};
    this.agent.subscribe(async (event) => {
      const normalizedEvent = event.type === "message_end"
        ? { ...event, message: this.normalizeAbortedMessage(event.message) }
        : event;
      if (event.type === "message_end") {
        if (normalizedEvent.type !== "message_end") return;
        if (normalizedEvent.message !== event.message) {
          const messages = this.agent.state.messages;
          this.agent.state.messages = [
            ...messages.slice(0, -1),
            normalizedEvent.message,
          ];
        }
        await this.session.appendMessage(normalizedEvent.message);
      }

      const runtimeEvent = this.toRuntimeEvent(normalizedEvent);
      if (!runtimeEvent) return;

      for (const listener of this.listeners) {
        await listener(runtimeEvent);
      }
    });
  }

  async run(
    message: string,
    listener?: RuntimeEventListener,
    images?: readonly ImageContent[],
  ): Promise<RuntimeRunResult> {
    if (this.running) throw new Error("Agent runtime already has an active run");
    this.running = true;
    this.abortRequested = false;
    if (listener) this.listeners.add(listener);

    return this.telemetryContext.startSpan(
      { name: "chalk.agent.run", attributes: this.telemetryAttributes },
      async (span) => {
        const startedAt = Date.now();
        const telemetryListener = (event: AgentRuntimeEvent) => {
          this.recordTelemetryEvent(span, event);
        };
        this.listeners.add(telemetryListener);
        try {
          await this.agent.prompt(message, images ? [...images] : undefined);
          const result = runStatus(lastAssistant(this.agent.state.messages));
          const usage = result.message?.role === "assistant" ? result.message.usage : undefined;
          span.setAttributes({
            status: result.status,
            durationMs: Date.now() - startedAt,
            ...(usage?.input !== undefined ? { inputTokens: usage.input } : {}),
            ...(usage?.output !== undefined ? { outputTokens: usage.output } : {}),
            ...(usage?.cost.total !== undefined ? { totalCost: usage.cost.total } : {}),
          });
          if (result.status === "failed") {
            span.setStatus({ status: "error" });
          }
          await this.emit({ type: "run_finished", status: result.status });
          return result;
        } catch (error) {
          span.setAttributes({ status: "failed", durationMs: Date.now() - startedAt });
          span.setStatus({ status: "error", error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : "Agent run failed" } });
          throw error;
        } finally {
          this.listeners.delete(telemetryListener);
          this.running = false;
          if (listener) this.listeners.delete(listener);
        }
      },
    );
  }

  abort() {
    if (this.running) this.abortRequested = true;
    this.agent.abort();
  }

  steer(message: string) {
    this.agent.steer({
      role: "user",
      content: [{ type: "text", text: message }],
      timestamp: Date.now(),
    });
  }

  followUp(message: string) {
    this.agent.followUp({
      role: "user",
      content: [{ type: "text", text: message }],
      timestamp: Date.now(),
    });
  }

  getMessages() {
    return this.agent.state.messages.slice();
  }

  private async emit(event: AgentRuntimeEvent) {
    for (const listener of this.listeners) await listener(event);
  }

  private normalizeAbortedMessage(message: AgentMessage): AgentMessage {
    if (
      this.abortRequested &&
      message.role === "assistant" &&
      message.stopReason === "error"
    ) {
      return { ...message, stopReason: "aborted" };
    }
    return message;
  }

  private recordTelemetryEvent(span: TelemetrySpan, event: AgentRuntimeEvent) {
    if (event.type === "tool_started") {
      span.addEvent("tool_started", { toolName: event.toolName });
    }
    if (event.type === "tool_pending") {
      span.addEvent("approval_pending", { toolName: event.toolName });
    }
    if (event.type === "tool_finished") {
      span.addEvent("tool_finished", {
        toolName: event.toolName,
        isError: event.isError,
      });
    }
  }

  private toRuntimeEvent(event: AgentEvent): AgentRuntimeEvent | undefined {
    switch (event.type) {
      case "agent_start":
        return { type: "run_started" };
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          return {
            type: "text_delta",
            delta: event.assistantMessageEvent.delta,
          };
        }
        if (event.assistantMessageEvent.type === "thinking_delta") {
          return {
            type: "thinking_delta",
            delta: event.assistantMessageEvent.delta,
          };
        }
        return undefined;
      case "message_end":
        return { type: "message_completed", message: event.message };
      case "tool_execution_start":
        return {
          type: "tool_started",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        };
      case "tool_execution_update":
        if (
          event.partialResult.details &&
          typeof event.partialResult.details === "object" &&
          "type" in event.partialResult.details &&
          event.partialResult.details.type === "approval_pending"
        ) {
          const details = event.partialResult.details as {
            toolCallId: string;
            toolName: string;
            label: string;
            args: unknown;
          };
          return {
            type: "tool_pending",
            toolCallId: details.toolCallId,
            toolName: details.toolName,
            label: details.label,
            args: details.args,
          };
        }
        return {
          type: "tool_updated",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          update: event.partialResult,
        };
      case "tool_execution_end":
        return {
          type: "tool_finished",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        };
      default:
        return undefined;
    }
  }
}

export async function createAgentRuntime(
  options: CreateAgentRuntimeOptions,
): Promise<AgentRuntime> {
  const catalog =
    options.models instanceof Object && "resolve" in options.models
      ? (options.models as ModelCatalog)
      : createModelCatalogFromModels(options.models as Models);
  const model = await catalog.resolveSelection(options.model);
  const allHistory = await options.session.getMessages();
  const lastSummaryIndex = allHistory.reduce(
    (index, message, current) =>
      "role" in message && message.role === "compactionSummary" ? current : index,
    -1,
  );
  let history = lastSummaryIndex >= 0
    ? allHistory.slice(lastSummaryIndex)
    : allHistory;
  const scaledReserve = Math.max(64, Math.floor(model.contextWindow * 0.25));
  const scaledKeep = Math.max(64, Math.floor(model.contextWindow * 0.25));
  const compactionSettings: CompactionSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    reserveTokens: scaledReserve,
    keepRecentTokens: scaledKeep,
    ...options.compaction,
  };
  const contextEstimate = estimateContextTokens(history);
  if (
    compactionSettings.enabled &&
    shouldCompact(contextEstimate.tokens, model.contextWindow, compactionSettings)
  ) {
    const keep: AgentMessage[] = [];
    let keptTokens = 0;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index]!;
      if (keptTokens >= compactionSettings.keepRecentTokens) break;
      keep.unshift(message);
      keptTokens += estimateTokens(message);
    }
    const toSummarize = history.slice(0, Math.max(0, history.length - keep.length));
    if (toSummarize.length > 0) {
      const models = options.models instanceof Object && "resolve" in options.models
        ? (options.models as ModelCatalog).getRawModels()
        : (options.models as Models);
      const summary = await generateSummary(
        toSummarize,
        models,
        model,
        compactionSettings.reserveTokens,
      );
      if (summary.ok) {
        const summaryMessage = createCompactionSummaryMessage(
          summary.value,
          contextEstimate.tokens,
          Date.now(),
        );
        await options.session.appendCompaction({
          summary: summary.value,
          retainedTail: keep,
          tokensBefore: contextEstimate.tokens,
        });
        history = [summaryMessage, ...keep];
      }
    }
  }
  const agent = new Agent({
    streamFn: catalog.streamSimple,
    convertToLlm,
    sessionId: options.session.descriptor.id,
    toolExecution: "sequential",
    initialState: {
      systemPrompt: options.systemPrompt,
      model,
      thinkingLevel: options.model.thinkingLevel,
      tools: options.tools ?? [],
      messages: history,
    },
  });

  return new AgentRuntime(agent, options.session, options.telemetry);
}
