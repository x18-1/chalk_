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
import {
  createAssistantMessageEventStream,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Api,
  type ImageContent,
  type Model,
  type ModelThinkingLevel,
  type Models,
} from "@earendil-works/pi-ai";

import type { RuntimeSession } from "../session/session-repository";
import {
  defaultRuntimeTelemetry,
  type AgentRunObservation,
  type RuntimeTelemetryOptions,
} from "../telemetry/telemetry";
import type { TelemetrySpan } from "@earendil-works/pi-telemetry";
import type { ToolErrorChannel } from "../tools/tool-registry";

function errorCategory(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  if (error instanceof Error && /timeout/i.test(error.message)) return "timeout";
  if (error instanceof Error && /approval|reject/i.test(error.message)) return "rejected";
  return error instanceof Error ? error.name : "unknown";
}

function modelStreamWithTelemetry(
  stream: Models["streamSimple"],
  context: RuntimeTelemetryOptions["context"],
  model: Parameters<Models["streamSimple"]>[0],
  requestContext: Parameters<Models["streamSimple"]>[1],
  options: Parameters<Models["streamSimple"]>[2],
): AssistantMessageEventStream {
  if (!context) return stream(model, requestContext, options);
  const source = stream(model, requestContext, options);
  const output = createAssistantMessageEventStream();
  void context.startSpan(
    { name: "chalk.agent.model_call", attributes: { providerId: model.provider, modelId: model.id } },
    async (span) => {
      const startedAt = Date.now();
      try {
        for await (const event of source) {
          output.push(event as AssistantMessageEvent);
          if (event.type === "done") {
            const usage = event.message.usage;
            span.setAttributes({
              status: "completed",
              durationMs: Date.now() - startedAt,
              ...(usage.input !== undefined ? { inputTokens: usage.input } : {}),
              ...(usage.output !== undefined ? { outputTokens: usage.output } : {}),
              ...(usage.cost.total !== undefined ? { totalCost: usage.cost.total } : {}),
              finishReason: event.reason,
            });
            output.end(event.message);
          } else if (event.type === "error") {
            span.setAttributes({
              status: event.reason === "aborted" ? "aborted" : "failed",
              durationMs: Date.now() - startedAt,
              finishReason: event.reason,
              errorCategory: errorCategory(event.error.errorMessage),
            });
            span.setStatus({ status: "error", error: { name: event.reason, message: "Model request failed" } });
            output.end(event.error);
          }
        }
      } catch (error) {
        span.setAttributes({ status: "failed", durationMs: Date.now() - startedAt, errorCategory: errorCategory(error) });
        span.setStatus({ status: "error", error: { name: error instanceof Error ? error.name : "Error", message: "Model request failed" } });
        output.end();
      }
    },
  );
  return output;
}

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
      errorCode?: string;
    }
  | { type: "run_finished"; status: RuntimeRunResult["status"] };

export type RuntimeRunResult = {
  status: "completed" | "aborted" | "failed";
  message?: AgentMessage;
  error?: string;
};

export type AgentLlm = {
  models: Models;
  model: Model<Api>;
  thinkingLevel: ModelThinkingLevel;
};

export type CreateAgentRuntimeOptions = {
  session: RuntimeSession;
  llm: AgentLlm;
  systemPrompt: string;
  tools?: AgentTool[];
  telemetry?: RuntimeTelemetryOptions;
  compaction?: Partial<CompactionSettings>;
  toolErrorChannel?: ToolErrorChannel;
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
  private readonly telemetryObserver;
  private activeSpan?: TelemetrySpan;

  constructor(
    private readonly agent: Agent,
    private readonly session: RuntimeSession,
    telemetry: RuntimeTelemetryOptions = defaultRuntimeTelemetry,
    private readonly toolErrorChannel?: ToolErrorChannel,
  ) {
    this.telemetryContext = telemetry.context ?? defaultRuntimeTelemetry.context;
    this.telemetryAttributes = telemetry.attributes ?? {};
    this.telemetryObserver = telemetry.onRunFinished;
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
        this.activeSpan = span;
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
          await this.persistRunObservation(span, {
            status: result.status,
            startedAt,
            durationMs: Date.now() - startedAt,
            ...(usage?.input !== undefined ? { inputTokens: usage.input } : {}),
            ...(usage?.output !== undefined ? { outputTokens: usage.output } : {}),
            ...(usage?.cost.total !== undefined ? { totalCost: usage.cost.total } : {}),
            ...(result.error ? { errorCategory: errorCategory(result.error) } : {}),
          });
          await this.emit({ type: "run_finished", status: result.status });
          return result;
        } catch (error) {
          span.setAttributes({ status: "failed", durationMs: Date.now() - startedAt });
          span.setStatus({ status: "error", error: { name: error instanceof Error ? error.name : "Error", message: "Agent run failed" } });
          await this.persistRunObservation(span, {
            status: "failed",
            startedAt,
            durationMs: Date.now() - startedAt,
            errorCategory: errorCategory(error),
          });
          throw error;
        } finally {
          this.listeners.delete(telemetryListener);
          this.running = false;
          this.activeSpan = undefined;
          if (listener) this.listeners.delete(listener);
        }
      },
    );
  }

  abort() {
    if (this.running) this.abortRequested = true;
    this.activeSpan?.addEvent("abort_requested", { source: "runtime" });
    this.agent.abort();
  }

  steer(message: string) {
    this.activeSpan?.addEvent("steer", { source: "runtime" });
    this.agent.steer({
      role: "user",
      content: [{ type: "text", text: message }],
      timestamp: Date.now(),
    });
  }

  followUp(message: string) {
    this.activeSpan?.addEvent("follow_up", { source: "runtime" });
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

  private async persistRunObservation(
    span: TelemetrySpan,
    observation: AgentRunObservation,
  ) {
    try {
      await this.telemetryObserver?.(observation);
    } catch {
      span.addEvent("observation_persistence_failed");
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
          ...(event.isError ? { errorCode: this.toolErrorChannel?.consume(event.toolCallId)?.code } : {}),
        };
      default:
        return undefined;
    }
  }
}

export async function createAgentRuntime(
  options: CreateAgentRuntimeOptions,
): Promise<AgentRuntime> {
  const { models, model, thinkingLevel } = options.llm;
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
      const compact = async () => generateSummary(
        toSummarize,
        models,
        model,
        compactionSettings.reserveTokens,
      );
      const summary = options.telemetry?.context
        ? await options.telemetry.context.startSpan(
          {
            name: "chalk.agent.compaction",
            attributes: { sessionId: options.session.descriptor.id, modelId: model.id },
          },
          async (span) => {
            const startedAt = Date.now();
            try {
              const result = await compact();
              span.setAttributes({
                status: result.ok ? "completed" : "failed",
                durationMs: Date.now() - startedAt,
                tokensBefore: contextEstimate.tokens,
                tokensRetained: keptTokens,
                messagesSummarized: toSummarize.length,
                ...(!result.ok ? { errorCategory: "summary_failed" } : {}),
              });
              if (!result.ok) span.setStatus({ status: "error", error: { name: "CompactionError", message: "Compaction summary failed" } });
              return result;
            } catch (error) {
              span.setAttributes({ status: "failed", durationMs: Date.now() - startedAt, errorCategory: errorCategory(error) });
              span.setStatus({ status: "error", error: { name: error instanceof Error ? error.name : "Error", message: "Compaction failed" } });
              throw error;
            }
          },
        )
        : await compact();
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
    streamFn: (requestModel, requestContext, streamOptions) =>
      modelStreamWithTelemetry(
        (streamModel, context, streamOptions) =>
          models.streamSimple(streamModel, context, streamOptions),
        options.telemetry?.context,
        requestModel,
        requestContext,
        streamOptions,
      ),
    convertToLlm,
    sessionId: options.session.descriptor.id,
    // Pi runs independent tool calls concurrently and automatically falls back
    // to a sequential batch when any declared tool is a sequential barrier.
    toolExecution: "parallel",
    initialState: {
      systemPrompt: options.systemPrompt,
      model,
      thinkingLevel,
      tools: options.tools ?? [],
      messages: history,
    },
  });

  return new AgentRuntime(agent, options.session, options.telemetry, options.toolErrorChannel);
}
