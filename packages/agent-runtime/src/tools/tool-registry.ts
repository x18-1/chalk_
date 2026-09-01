import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { TelemetryContext } from "@earendil-works/pi-telemetry";

export type ToolSource = "builtin" | "chalk" | "mcp" | "subagent";

export type ToolEffect = "read" | "write" | "network" | "process" | "paid";

export type ToolApprovalPolicy = "none" | "required" | "conditional";

export type ToolLimits = {
  timeoutMs?: number;
  maxResultCharacters?: number;
  maxUpdateCharacters?: number;
};

export type ToolErrorCode =
  | "invalid_definition"
  | "approval_required"
  | "approval_rejected"
  | "approval_timed_out"
  | "cancelled"
  | "timed_out"
  | "invalid_arguments"
  | "read_cursor_invalid"
  | "read_cursor_expired"
  | "read_snapshot_changed"
  | "read_access_denied"
  | "read_unsupported_media_type"
  | "read_unsupported_resource"
  | "read_line_too_large"
  | "read_resource_too_large"
  | "skill_not_found"
  | "skill_disabled"
  | "skill_model_invocation_disabled"
  | "skill_reference_invalid"
  | "skill_reference_not_found"
  | "skill_definition_invalid"
  | "skill_name_conflict"
  | "tool_call_conflict"
  | "execution_failed";

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const MAX_TOOL_TIMEOUT_MS = 120_000;
export const DEFAULT_TOOL_RESULT_CHARACTERS = 12_000;
export const MAX_TOOL_RESULT_CHARACTERS = 32_000;
export const DEFAULT_TOOL_UPDATE_CHARACTERS = 4_000;
export const MAX_TOOL_UPDATE_CHARACTERS = 8_000;

export class ToolExecutionError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ToolExecutionError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export type ToolErrorObservation = {
  toolCallId: string;
  toolName: string;
  code: ToolErrorCode;
};

/** Pi converts thrown errors into plain tool results; keep Chalk's code out of user text. */
export class ToolErrorChannel {
  private readonly pending = new Map<string, ToolErrorObservation>();

  record(observation: ToolErrorObservation) {
    this.pending.set(observation.toolCallId, observation);
  }

  consume(toolCallId: string) {
    const observation = this.pending.get(toolCallId);
    if (observation) this.pending.delete(toolCallId);
    return observation;
  }
}

type ToolContent = TextContent | ImageContent;

export type ToolSummary = {
  name: string;
  label: string;
  description: string;
  source: ToolSource;
  effects: readonly ToolEffect[];
  approvalPolicy: ToolApprovalPolicy;
  limits: Required<ToolLimits>;
  defaultEnabled: boolean;
  executionMode: "sequential" | "parallel";
  requiresApproval: boolean;
};

export type ToolApprovalMode = "default" | "always" | "never";

type ApprovalPredicate<TParameters extends TSchema> = {
  bivarianceHack(
    args: Static<TParameters>,
    context: RuntimeToolContext,
    signal?: AbortSignal,
  ): boolean | Promise<boolean>;
}["bivarianceHack"];

export type RuntimeToolContext = {
  ownerId: string;
  sessionId: string;
  conversationId?: string;
};

export type ToolApprovalRequest = {
  toolCallId: string;
  toolName: string;
  label: string;
  args: unknown;
  context: RuntimeToolContext;
};

export type ToolApprovalDecision = {
  approved: boolean;
  reason?: string;
  errorCode?: "approval_rejected" | "approval_timed_out";
};

export interface ApprovalPort {
  request(
    request: ToolApprovalRequest,
    signal?: AbortSignal,
    onPending?: () => void,
  ): Promise<ToolApprovalDecision>;
}

export interface RuntimeTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  source: ToolSource;
  effects: readonly ToolEffect[];
  approvalPolicy: ToolApprovalPolicy;
  defaultEnabled: boolean;
  limits?: ToolLimits;
  /** @deprecated Use approvalPolicy and an approval predicate for conditional policies. */
  requiresApproval?:
    | boolean
    | ApprovalPredicate<TParameters>;
  executionMode?: "sequential" | "parallel";
  /** Optional compatibility shim applied before Agent Runtime schema validation. */
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute(
    args: Static<TParameters>,
    context: RuntimeToolContext,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ): Promise<AgentToolResult<TDetails>>;
}

export type CreateAgentToolsOptions = {
  context: RuntimeToolContext;
  telemetry?: TelemetryContext;
  approval?: ApprovalPort;
  enabledToolNames?: ReadonlySet<string>;
  approvalModes?: ReadonlyMap<string, ToolApprovalMode>;
  errorChannel?: ToolErrorChannel;
};

function summaryRequiresApproval(tool: RuntimeTool<any>) {
  return tool.approvalPolicy !== "none" || typeof tool.requiresApproval === "function";
}

type NormalizedTool = RuntimeTool<any> & {
  limits: Required<ToolLimits>;
  executionMode: "sequential" | "parallel";
};

const TOOL_SOURCES = new Set<ToolSource>(["builtin", "chalk", "mcp", "subagent"]);
const TOOL_EFFECTS = new Set<ToolEffect>(["read", "write", "network", "process", "paid"]);

function invalidDefinition(message: string): never {
  throw new ToolExecutionError("invalid_definition", message);
}

function normalizeLimits(tool: RuntimeTool<any>): Required<ToolLimits> {
  const limits = tool.limits ?? {};
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const maxResultCharacters = limits.maxResultCharacters ?? DEFAULT_TOOL_RESULT_CHARACTERS;
  const maxUpdateCharacters = limits.maxUpdateCharacters ?? DEFAULT_TOOL_UPDATE_CHARACTERS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TOOL_TIMEOUT_MS) {
    invalidDefinition(`Tool ${tool.name} timeout must be an integer between 1 and ${MAX_TOOL_TIMEOUT_MS}`);
  }
  if (!Number.isInteger(maxResultCharacters) || maxResultCharacters < 1 || maxResultCharacters > MAX_TOOL_RESULT_CHARACTERS) {
    invalidDefinition(`Tool ${tool.name} result limit must be an integer between 1 and ${MAX_TOOL_RESULT_CHARACTERS}`);
  }
  if (!Number.isInteger(maxUpdateCharacters) || maxUpdateCharacters < 1 || maxUpdateCharacters > MAX_TOOL_UPDATE_CHARACTERS) {
    invalidDefinition(`Tool ${tool.name} update limit must be an integer between 1 and ${MAX_TOOL_UPDATE_CHARACTERS}`);
  }
  return { timeoutMs, maxResultCharacters, maxUpdateCharacters };
}

function normalizeTool(tool: RuntimeTool<any>): NormalizedTool {
  if (!tool || typeof tool !== "object") invalidDefinition("Tool definition must be an object");
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(tool.name)) {
    invalidDefinition(`Tool name is invalid: ${tool.name}`);
  }
  if (!tool.label?.trim()) invalidDefinition(`Tool ${tool.name} label cannot be empty`);
  if (!tool.description?.trim()) invalidDefinition(`Tool ${tool.name} description cannot be empty`);
  if (!TOOL_SOURCES.has(tool.source)) invalidDefinition(`Tool ${tool.name} has an invalid source`);
  if (!Array.isArray(tool.effects) || tool.effects.length === 0 || tool.effects.some((effect) => !TOOL_EFFECTS.has(effect))) {
    invalidDefinition(`Tool ${tool.name} must declare at least one valid effect`);
  }
  if (!["none", "required", "conditional"].includes(tool.approvalPolicy)) {
    invalidDefinition(`Tool ${tool.name} has an invalid approval policy`);
  }
  if (tool.approvalPolicy === "conditional" && typeof tool.requiresApproval !== "function") {
    invalidDefinition(`Tool ${tool.name} requires an approval predicate for a conditional policy`);
  }
  if (tool.approvalPolicy === "none" && typeof tool.requiresApproval === "function") {
    invalidDefinition(`Tool ${tool.name} cannot declare an approval predicate while its policy is none`);
  }
  if (typeof tool.defaultEnabled !== "boolean") {
    invalidDefinition(`Tool ${tool.name} must declare defaultEnabled`);
  }
  if (tool.approvalPolicy === "none" && tool.requiresApproval === true) {
    invalidDefinition(`Tool ${tool.name} cannot require approval while its policy is none`);
  }
  if (
    tool.approvalPolicy === "none" &&
    tool.effects.some((effect) => effect === "write" || effect === "process" || effect === "paid")
  ) {
    invalidDefinition(`Tool ${tool.name} declares side effects that require approval`);
  }
  if (!tool.parameters || typeof tool.parameters !== "object" || typeof tool.parameters.type !== "string") {
    invalidDefinition(`Tool ${tool.name} must provide a TypeBox schema`);
  }
  if (typeof tool.execute !== "function") invalidDefinition(`Tool ${tool.name} must provide execute`);
  if (tool.executionMode !== undefined && !["sequential", "parallel"].includes(tool.executionMode)) {
    invalidDefinition(`Tool ${tool.name} has an invalid execution mode`);
  }
  return {
    ...tool,
    limits: normalizeLimits(tool),
    executionMode: tool.executionMode ?? "sequential",
  };
}

async function platformRequiresApproval(
  tool: RuntimeTool<any>,
  args: unknown,
  context: RuntimeToolContext,
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    throw new ToolExecutionError("cancelled", "Tool execution was cancelled");
  }
  if (tool.approvalPolicy === "required") return true;
  if (tool.approvalPolicy === "conditional") {
    if (typeof tool.requiresApproval !== "function") {
      throw new ToolExecutionError("invalid_definition", `Tool ${tool.name} has no approval predicate`);
    }
    return tool.requiresApproval(args, context, signal);
  }
  return tool.requiresApproval === true;
}

function textCharacters(content: ToolContent[]) {
  return content.reduce(
    (total, item) => total + (item.type === "text" ? item.text.length : 0),
    0,
  );
}

function limitContent(
  content: ToolContent[],
  maxCharacters: number,
): { content: ToolContent[]; truncated: boolean; originalCharacters: number } {
  const originalCharacters = textCharacters(content);
  if (originalCharacters <= maxCharacters) {
    return { content, truncated: false, originalCharacters };
  }

  let remaining = maxCharacters;
  const bounded: ToolContent[] = content.flatMap((item): ToolContent[] => {
    if (item.type !== "text") return [item];
    if (remaining <= 0) return [];
    if (item.text.length <= remaining) {
      remaining -= item.text.length;
      return [item];
    }
    const marker = "[truncated]".slice(0, remaining);
    const prefixLength = Math.max(0, remaining - marker.length);
    remaining = 0;
    return [{ type: "text" as const, text: item.text.slice(0, prefixLength) + marker }];
  });
  return { content: bounded, truncated: true, originalCharacters };
}

function limitResult(result: AgentToolResult<unknown>, limits: Required<ToolLimits>): AgentToolResult<unknown> {
  const bounded = limitContent(result.content, limits.maxResultCharacters);
  if (!bounded.truncated) return result;
  const details = result.details && typeof result.details === "object" && !Array.isArray(result.details)
    ? result.details as Record<string, unknown>
    : { value: result.details };
  return {
    ...result,
    content: bounded.content,
    details: {
      ...details,
      resultTruncated: {
        originalCharacters: bounded.originalCharacters,
        maxCharacters: limits.maxResultCharacters,
      },
    },
  };
}

function limitUpdate<T>(
  update: AgentToolResult<T>,
  maxCharacters: number,
) {
  const bounded = limitContent(update.content, maxCharacters);
  return bounded.truncated ? { ...update, content: bounded.content } : update;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
  return `{${entries.join(",")}}`;
}

type ToolCallExecution = {
  fingerprint: string;
  promise: Promise<AgentToolResult<unknown>>;
};

function toAgentTool(
  tool: NormalizedTool,
  options: CreateAgentToolsOptions,
  executions: Map<string, ToolCallExecution>,
): AgentTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.prepareArguments ? { prepareArguments: tool.prepareArguments } : {}),
    executionMode: tool.executionMode,
    async execute(toolCallId, args, signal, onUpdate) {
      const fingerprint = `${tool.name}:${stableSerialize(args)}`;
      const existing = executions.get(toolCallId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          const conflict = new ToolExecutionError(
            "tool_call_conflict",
            `Tool call id ${toolCallId} was reused with different arguments`,
          );
          options.errorChannel?.record({ toolCallId, toolName: tool.name, code: conflict.code });
          throw conflict;
        }
        return existing.promise;
      }

      const promise = (async () => {
        try {
        if (!Value.Check(tool.parameters, args)) {
          throw new ToolExecutionError("invalid_arguments", `Tool ${tool.name} received invalid arguments`);
        }
        if (signal?.aborted) {
          throw new ToolExecutionError("cancelled", "Tool execution was cancelled");
        }
        const executeTool = async (span?: import("@earendil-works/pi-telemetry").TelemetrySpan) => {
        const platformApproval = await platformRequiresApproval(tool, args, options.context, signal);
        const mode = options.approvalModes?.get(tool.name) ?? "default";
        // A user may request more prompts, but cannot lower the platform floor.
        const needsApproval = mode === "always" || platformApproval;
        if (needsApproval) {
          if (!options.approval) {
            throw new ToolExecutionError(
              "approval_required",
              `Tool ${tool.name} requires approval, but no approval port is configured`,
            );
          }

          const waitStartedAt = Date.now();
          const requestApproval = async (approvalSpan?: import("@earendil-works/pi-telemetry").TelemetrySpan) => {
            const decision = await options.approval!.request(
              { toolCallId, toolName: tool.name, label: tool.label, args, context: options.context },
              signal,
              () => {
                span?.addEvent("approval_pending", { waitStartedAt });
                onUpdate?.({
                  content: [{ type: "text", text: `Waiting for approval to run ${tool.label}` }],
                  details: { type: "approval_pending", toolCallId, toolName: tool.name, label: tool.label, args },
                });
              },
            );
            approvalSpan?.setAttributes({
              status: decision.approved ? "approved" : "rejected",
              durationMs: Date.now() - waitStartedAt,
            });
            span?.addEvent("approval_decided", { approved: decision.approved, waitDurationMs: Date.now() - waitStartedAt });
            if (!decision.approved) {
              throw new ToolExecutionError(
                decision.errorCode ?? "approval_rejected",
                decision.reason ?? `Tool ${tool.name} was rejected`,
              );
            }
            return decision;
          };
          try {
            if (options.telemetry) {
              await options.telemetry.startSpan(
                { name: "chalk.agent.approval", attributes: { toolCallId, toolName: tool.name } },
                requestApproval,
              );
            } else {
              await requestApproval();
            }
          } catch (error) {
            if (error instanceof ToolExecutionError) throw error;
            if (signal?.aborted) throw new ToolExecutionError("cancelled", "Tool approval was cancelled", error);
            throw new ToolExecutionError("approval_timed_out", "Tool approval failed", error);
          }
        }

        if (signal?.aborted) {
          throw new ToolExecutionError("cancelled", "Tool execution was cancelled");
        }

        const controller = new AbortController();
        let timeout: NodeJS.Timeout | undefined;
        let rejectCancelled: ((error: ToolExecutionError) => void) | undefined;
        const cancelled = signal
          ? new Promise<never>((_, reject) => {
            rejectCancelled = reject;
          })
          : undefined;
        const timedOut = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            const error = new ToolExecutionError("timed_out", `Tool ${tool.name} timed out`);
            controller.abort(error);
            reject(error);
          }, tool.limits.timeoutMs);
        });
        const update = (partialResult: AgentToolResult<unknown>) => {
          onUpdate?.(limitUpdate(partialResult, tool.limits.maxUpdateCharacters));
        };
        const parentAbort = () => {
          const error = signal?.reason instanceof ToolExecutionError
            ? signal.reason
            : new ToolExecutionError("cancelled", "Tool execution was cancelled");
          controller.abort(error);
          rejectCancelled?.(error);
        };
        signal?.addEventListener("abort", parentAbort, { once: true });
        if (signal?.aborted) parentAbort();
        const execution = Promise.resolve().then(() =>
          controller.signal.aborted
            ? Promise.reject(new ToolExecutionError("cancelled", "Tool execution was cancelled"))
            : tool.execute(args, options.context, controller.signal, update),
        );
        try {
          const result = await Promise.race([execution, timedOut, ...(cancelled ? [cancelled] : [])]);
          const bounded = limitResult(result, tool.limits);
          span?.setAttributes({
            status: "completed",
            ...(bounded.details && typeof bounded.details === "object" && "resultTruncated" in bounded.details
              ? { resultTruncated: true }
              : {}),
          });
          return bounded;
        } catch (error) {
          if (error instanceof ToolExecutionError) throw error;
          if (signal?.aborted) throw new ToolExecutionError("cancelled", "Tool execution was cancelled", error);
          throw new ToolExecutionError("execution_failed", `Tool ${tool.name} failed`, error);
        } finally {
          if (timeout) clearTimeout(timeout);
          signal?.removeEventListener("abort", parentAbort);
        }
        };
        if (!options.telemetry) return await executeTool();
        return await options.telemetry.startSpan(
        { name: "chalk.agent.tool_call", attributes: { toolCallId, toolName: tool.name, source: tool.source } },
        async (span) => {
          const startedAt = Date.now();
          try {
            const result = await executeTool(span);
            span.setAttributes({ durationMs: Date.now() - startedAt });
            return result;
          } catch (error) {
            const code = error instanceof ToolExecutionError ? error.code : "execution_failed";
            span.setAttributes({
              status: code === "approval_rejected" || code === "approval_timed_out" ? "rejected" : "failed",
              durationMs: Date.now() - startedAt,
              errorCategory: code,
            });
            span.setStatus({ status: "error", error: { name: error instanceof Error ? error.name : "Error", message: "Tool execution failed" } });
            throw error;
          }
        },
        );
        } catch (error) {
          const normalized = error instanceof ToolExecutionError
            ? error
            : new ToolExecutionError("execution_failed", `Tool ${tool.name} failed`, error);
          options.errorChannel?.record({ toolCallId, toolName: tool.name, code: normalized.code });
          throw normalized;
        }
      })();
      executions.set(toolCallId, { fingerprint, promise });
      return promise;
    },
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, NormalizedTool>();
  // A registry normally lives for the lifetime of one Agent runtime. Keeping
  // this cache on the registry (instead of recreating it for every Pi adapter)
  // makes toolCallId idempotency survive adapter/snapshot recreation.
  private readonly executions = new Map<string, ToolCallExecution>();

  constructor(tools: readonly RuntimeTool<any>[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: RuntimeTool<any>) {
    const normalized = normalizeTool(tool);
    if (this.tools.has(normalized.name)) {
      throw new Error(`Tool ${tool.name} is already registered`);
    }
    this.tools.set(normalized.name, normalized);
  }

  list(): ToolSummary[] {
    return Array.from(this.tools.values(), (tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      source: tool.source,
      effects: tool.effects,
      approvalPolicy: tool.approvalPolicy,
      limits: tool.limits as Required<ToolLimits>,
      defaultEnabled: tool.defaultEnabled,
      executionMode: tool.executionMode,
      requiresApproval: summaryRequiresApproval(tool),
    }));
  }

  createAgentTools(options: CreateAgentToolsOptions): AgentTool[] {
    return Array.from(this.tools.values())
      .filter(
        (tool) =>
          options.enabledToolNames
            ? options.enabledToolNames.has(tool.name)
            : tool.defaultEnabled,
      )
      .map((tool) => toAgentTool(tool, options, this.executions));
  }
}
