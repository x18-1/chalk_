import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

import type {
  AgentRuntime,
  AgentRuntimeEvent,
} from "../runtime/agent-runtime";
import type {
  RuntimeSession,
  SessionRepository,
} from "../session/session-repository";
import {
  ToolExecutionError,
  type RuntimeTool,
  type ToolSummary,
} from "../tools/tool-registry";

export const SUBAGENT_TOOL_NAME = "run_subagent";
export const SUBAGENT_TIMEOUT_MS = 60_000;
export const SUBAGENT_MAX_RESULT_CHARACTERS = 12_000;

export type SubagentRunContext = {
  ownerId: string;
  conversationId?: string;
  parentSessionId: string;
};

export type SubagentRunInput = {
  task: string;
};

export type SubagentRunResult = {
  childSessionId: string;
  status: "completed" | "aborted" | "timed_out" | "failed";
  output: string;
  error?: "cancelled" | "timed_out" | "runtime_failed";
  durationMs: number;
};

export interface SubagentAuditPort {
  started(input: {
    context: SubagentRunContext;
    childSessionId: string;
    timeoutMs: number;
  }): Promise<{ id: string } | void>;
  finished(input: {
    id?: string;
    context: SubagentRunContext;
    result: SubagentRunResult;
  }): Promise<void>;
}

export type CreateSubagentRuntime = (input: {
  session: RuntimeSession;
  context: SubagentRunContext;
  signal?: AbortSignal;
}) => Promise<AgentRuntime> | AgentRuntime;

export type ForegroundSubagentExecutorOptions = {
  sessions: SessionRepository;
  createRuntime: CreateSubagentRuntime;
  audit?: SubagentAuditPort;
};

function messageText(message: AgentMessage | undefined) {
  if (
    !message ||
    !("content" in message) ||
    !Array.isArray(message.content)
  ) return "";
  return message.content
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("");
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof ToolExecutionError
    ? signal.reason
    : new ToolExecutionError("cancelled", "Subagent execution was cancelled");
}

async function waitForSignal<T>(value: PromiseLike<T> | T, signal?: AbortSignal): Promise<T> {
  if (!signal) return await value;
  if (signal.aborted) throw abortError(signal);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(abortError(signal));
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener("abort", aborted);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

async function finishAudit(
  audit: SubagentAuditPort | undefined,
  input: Parameters<SubagentAuditPort["finished"]>[0],
) {
  try {
    await audit?.finished(input);
  } catch {
    // The child has already reached a terminal state. Audit persistence is
    // best effort here and must not rewrite or replay the completed work.
  }
}

function failedResult(
  childSessionId: string,
  startedAt: number,
  error: unknown,
  signal?: AbortSignal,
): SubagentRunResult {
  const normalized = error instanceof ToolExecutionError ? error : undefined;
  const status = normalized?.code === "timed_out"
    ? "timed_out"
    : signal?.aborted || normalized?.code === "cancelled"
      ? "aborted"
      : "failed";
  return {
    childSessionId,
    status,
    output: "",
    error: status === "timed_out"
      ? "timed_out"
      : status === "aborted"
        ? "cancelled"
        : "runtime_failed",
    durationMs: Date.now() - startedAt,
  };
}

export class ForegroundSubagentExecutor {
  constructor(private readonly options: ForegroundSubagentExecutorOptions) {}

  async run(
    input: SubagentRunInput,
    context: SubagentRunContext,
    signal?: AbortSignal,
    listener?: (event: AgentRuntimeEvent) => void,
  ): Promise<SubagentRunResult> {
    if (!input.task.trim() || input.task.length > 8_000) {
      throw new ToolExecutionError(
        "invalid_arguments",
        "Subagent task must contain between 1 and 8000 characters",
      );
    }
    if (signal?.aborted) throw abortError(signal);

    const startedAt = Date.now();
    let session: RuntimeSession | undefined;
    let auditId: string | undefined;
    let runtime: AgentRuntime | undefined;
    let result: SubagentRunResult | undefined;
    const abortRuntime = () => runtime?.abort();
    signal?.addEventListener("abort", abortRuntime, { once: true });

    try {
      session = await waitForSignal(
        this.options.sessions.create({ ownerId: context.ownerId }),
        signal,
      );
      const audit = await waitForSignal(this.options.audit?.started({
        context,
        childSessionId: session.descriptor.id,
        timeoutMs: SUBAGENT_TIMEOUT_MS,
      }), signal);
      auditId = audit?.id;
      runtime = await waitForSignal(this.options.createRuntime({
        session,
        context,
        ...(signal ? { signal } : {}),
      }), signal);
      if (signal?.aborted) throw abortError(signal);

      const run = await waitForSignal(runtime.run(input.task, listener), signal);
      result = {
        childSessionId: session.descriptor.id,
        status: run.status,
        output: messageText(run.message).slice(0, SUBAGENT_MAX_RESULT_CHARACTERS),
        ...(run.status === "aborted"
          ? { error: "cancelled" as const }
          : run.status === "failed"
            ? { error: "runtime_failed" as const }
            : {}),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (!session) {
        if (error instanceof ToolExecutionError) throw error;
        throw new ToolExecutionError(
          "execution_failed",
          "Unable to create an isolated Subagent session",
          error,
        );
      }
      result = failedResult(session.descriptor.id, startedAt, error, signal);
    } finally {
      signal?.removeEventListener("abort", abortRuntime);
    }

    await finishAudit(this.options.audit, {
      ...(auditId ? { id: auditId } : {}),
      context,
      result,
    });
    return result;
  }
}

const subagentParameters = Type.Object({
  task: Type.String({ minLength: 1, maxLength: 8_000 }),
});

export const SUBAGENT_TOOL_SUMMARY = Object.freeze({
  name: SUBAGENT_TOOL_NAME,
  label: "专项子任务",
  description: "让一个隔离的前台子 Agent 在独立会话中处理单个范围明确的任务，并返回有界摘要。",
  source: "subagent",
  effects: ["process", "paid", "write"],
  approvalPolicy: "required",
  limits: {
    timeoutMs: SUBAGENT_TIMEOUT_MS,
    maxResultCharacters: SUBAGENT_MAX_RESULT_CHARACTERS,
    maxUpdateCharacters: 4_000,
  },
  defaultEnabled: false,
  executionMode: "sequential",
  requiresApproval: true,
} satisfies ToolSummary);

export function createSubagentTool(
  executor: ForegroundSubagentExecutor,
): RuntimeTool<typeof subagentParameters> {
  return {
    ...SUBAGENT_TOOL_SUMMARY,
    parameters: subagentParameters,
    async execute(
      args: Static<typeof subagentParameters>,
      context,
      signal,
      onUpdate,
    ) {
      onUpdate?.({
        content: [{ type: "text", text: "子 Agent 正在处理专项任务" }],
        details: { type: "subagent_running" },
      });
      const result = await executor.run(
        { task: args.task },
        {
          ownerId: context.ownerId,
          parentSessionId: context.sessionId,
          ...(context.conversationId
            ? { conversationId: context.conversationId }
            : {}),
        },
        signal,
      );
      if (result.status !== "completed") {
        const code = result.status === "timed_out"
          ? "timed_out"
          : result.status === "aborted"
            ? "cancelled"
            : "execution_failed";
        throw new ToolExecutionError(code, `Subagent ${result.status}`);
      }
      return {
        content: [{ type: "text", text: result.output }],
        details: result,
      };
    },
  };
}
