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
import type { RuntimeTool } from "../tools/tool-registry";

export type SubagentRunContext = {
  ownerId: string;
  conversationId?: string;
  parentSessionId: string;
};

export type SubagentRunInput = {
  task: string;
  focus?: string;
  timeoutMs?: number;
};

export type SubagentRunResult = {
  childSessionId: string;
  childSessionPath: string;
  status: "completed" | "aborted" | "timed_out" | "failed";
  output: string;
  error?: string;
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
  task: string;
  focus?: string;
}) => Promise<AgentRuntime>;

export type ForegroundSubagentExecutorOptions = {
  sessions: SessionRepository;
  createRuntime: CreateSubagentRuntime;
  audit?: SubagentAuditPort;
  maxConcurrentPerOwner?: number;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  maxResultCharacters?: number;
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

export class ForegroundSubagentExecutor {
  private readonly activeByOwner = new Map<string, number>();
  private readonly maxConcurrentPerOwner: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly maxResultCharacters: number;

  constructor(private readonly options: ForegroundSubagentExecutorOptions) {
    this.maxConcurrentPerOwner = options.maxConcurrentPerOwner ?? 1;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 90_000;
    this.maxTimeoutMs = options.maxTimeoutMs ?? 180_000;
    this.maxResultCharacters = options.maxResultCharacters ?? 12_000;
  }

  async run(
    input: SubagentRunInput,
    context: SubagentRunContext,
    signal?: AbortSignal,
    listener?: (event: AgentRuntimeEvent) => void,
  ): Promise<SubagentRunResult> {
    const active = this.activeByOwner.get(context.ownerId) ?? 0;
    if (active >= this.maxConcurrentPerOwner) {
      throw new Error("Subagent concurrency limit reached for this user");
    }

    const timeoutMs = Math.min(
      Math.max(input.timeoutMs ?? this.defaultTimeoutMs, 1_000),
      this.maxTimeoutMs,
    );
    this.activeByOwner.set(context.ownerId, active + 1);
    const startedAt = Date.now();
    const session = await this.options.sessions.create({ ownerId: context.ownerId });
    let auditId: string | undefined;
    let runtime: AgentRuntime | undefined;
    let timedOut = false;
    const abort = () => runtime?.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      runtime?.abort();
    }, timeoutMs);

    try {
      const audit = await this.options.audit?.started({
        context,
        childSessionId: session.descriptor.id,
        timeoutMs,
      });
      auditId = audit?.id;
      runtime = await this.options.createRuntime({
        session,
        context,
        task: input.task,
        ...(input.focus ? { focus: input.focus } : {}),
      });
      if (signal?.aborted) runtime.abort();
      const run = await runtime.run(input.task, listener);
      const status = timedOut
        ? "timed_out"
        : run.status;
      const result: SubagentRunResult = {
        childSessionId: session.descriptor.id,
        childSessionPath: session.descriptor.path,
        status,
        output: messageText(run.message).slice(0, this.maxResultCharacters),
        ...(run.error ? { error: run.error } : {}),
        durationMs: Date.now() - startedAt,
      };
      await this.options.audit?.finished({
        ...(auditId ? { id: auditId } : {}),
        context,
        result,
      });
      return result;
    } catch (error) {
      const result: SubagentRunResult = {
        childSessionId: session.descriptor.id,
        childSessionPath: session.descriptor.path,
        status: timedOut ? "timed_out" : signal?.aborted ? "aborted" : "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
      await this.options.audit?.finished({
        ...(auditId ? { id: auditId } : {}),
        context,
        result,
      });
      return result;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      const remaining = (this.activeByOwner.get(context.ownerId) ?? 1) - 1;
      if (remaining > 0) this.activeByOwner.set(context.ownerId, remaining);
      else this.activeByOwner.delete(context.ownerId);
    }
  }
}

const subagentParameters = Type.Object({
  task: Type.String({ minLength: 1, maxLength: 8_000 }),
  focus: Type.Optional(Type.String({ maxLength: 1_000 })),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 10, maximum: 180 })),
});

export function createSubagentTool(
  executor: ForegroundSubagentExecutor,
): RuntimeTool<typeof subagentParameters> {
  return {
    name: "run_subagent",
    label: "专项子任务",
    description:
      "让一个隔离的前台子 Agent 在独立会话中处理范围明确的子任务，并返回有界摘要。",
    parameters: subagentParameters,
    source: "subagent",
    effects: ["process", "paid", "write"],
    approvalPolicy: "required",
    defaultEnabled: false,
    requiresApproval: true,
    executionMode: "sequential",
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
        {
          task: args.task,
          ...(args.focus ? { focus: args.focus } : {}),
          ...(args.timeoutSeconds
            ? { timeoutMs: args.timeoutSeconds * 1_000 }
            : {}),
        },
        {
          ownerId: context.ownerId,
          parentSessionId: context.sessionId,
          ...(context.conversationId
            ? { conversationId: context.conversationId }
            : {}),
        },
        signal,
      );
      return {
        content: [
          {
            type: "text",
            text:
              result.output ||
              `子 Agent 已${result.status === "timed_out" ? "超时" : "结束"}，没有返回文本。`,
          },
        ],
        details: result,
      };
    },
  };
}
