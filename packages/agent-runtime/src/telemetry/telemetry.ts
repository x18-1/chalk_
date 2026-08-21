import {
  defineTelemetrySchema,
  NOOP_TELEMETRY_CONTEXT,
  type SpanAttributes,
  type TelemetryContext,
} from "@earendil-works/pi-telemetry";

export const chalkTelemetrySchema = defineTelemetrySchema({
  version: 2,
  spans: {
    "chalk.agent.run": {
      description: "One Chalk Agent run for a conversation or child session",
      parents: { kind: "root_or_external" },
      startAttributes: {
        ownerId: { type: "string", required: true, sensitive: true, cardinality: "high", description: "Stable owner identifier" },
        sessionId: { type: "string", required: true, sensitive: true, cardinality: "high", description: "Stable session identifier" },
        conversationId: { type: "string", required: false, sensitive: true, cardinality: "high", description: "Stable conversation identifier" },
        modelProviderId: { type: "string", required: false, cardinality: "low", description: "Model provider" },
        modelId: { type: "string", required: false, cardinality: "high", description: "Model identifier" },
      },
      endAttributes: {
        status: { type: "string", required: false, values: ["completed", "aborted", "failed"], description: "Run outcome" },
        durationMs: { type: "number", required: false, description: "Wall clock duration" },
        inputTokens: { type: "number", required: false, description: "Input token count" },
        outputTokens: { type: "number", required: false, description: "Output token count" },
        totalCost: { type: "number", required: false, description: "Provider-reported cost" },
      },
      events: {
        tool_started: {
          description: "A tool began execution",
          attributes: {
            toolName: { type: "string", required: true, cardinality: "high", description: "Tool name" },
            source: { type: "string", required: false, cardinality: "low", description: "Tool source" },
          },
        },
        tool_finished: {
          description: "A tool finished execution",
          attributes: {
            toolName: { type: "string", required: true, cardinality: "high", description: "Tool name" },
            isError: { type: "boolean", required: true, description: "Whether execution failed" },
          },
        },
        approval_pending: {
          description: "A tool is waiting for human approval",
          attributes: {
            toolName: { type: "string", required: true, cardinality: "high", description: "Tool name" },
          },
        },
        steer: {
          description: "The active run received a steering message",
          attributes: { source: { type: "string", required: true, description: "Control source" } },
        },
        follow_up: {
          description: "A follow-up message was queued after the run",
          attributes: { source: { type: "string", required: true, description: "Control source" } },
        },
        abort_requested: {
          description: "The active run was asked to abort",
          attributes: { source: { type: "string", required: true, description: "Control source" } },
        },
        observation_persistence_failed: {
          description: "The run summary could not be persisted",
          attributes: {},
        },
      },
      status: { default: "ok", errorWhen: "The run fails or returns an error status" },
    },
    "chalk.agent.model_call": {
      description: "One provider model request within an Agent run",
      parents: { kind: "spans", spans: ["chalk.agent.run"] },
      startAttributes: {
        providerId: { type: "string", required: true, cardinality: "low", description: "Model provider" },
        modelId: { type: "string", required: true, cardinality: "high", description: "Model identifier" },
      },
      endAttributes: {
        status: { type: "string", required: false, values: ["completed", "failed", "aborted"], description: "Request outcome" },
        durationMs: { type: "number", required: false, description: "Wall clock duration" },
        inputTokens: { type: "number", required: false, description: "Input token count" },
        outputTokens: { type: "number", required: false, description: "Output token count" },
        totalCost: { type: "number", required: false, description: "Provider-reported cost" },
        finishReason: { type: "string", required: false, cardinality: "low", description: "Provider finish reason" },
        errorCategory: { type: "string", required: false, cardinality: "low", description: "Normalized error category" },
      },
      status: { default: "ok", errorWhen: "The provider request fails or is aborted" },
    },
    "chalk.agent.tool_call": {
      description: "One tool execution within an Agent run",
      parents: { kind: "spans", spans: ["chalk.agent.run", "chalk.agent.subagent"] },
      startAttributes: {
        toolCallId: { type: "string", required: true, sensitive: true, cardinality: "high", description: "Opaque tool call identifier" },
        toolName: { type: "string", required: true, cardinality: "high", description: "Tool name" },
        source: { type: "string", required: false, cardinality: "low", description: "Tool source" },
      },
      endAttributes: {
        status: { type: "string", required: false, values: ["completed", "failed", "rejected", "aborted"], description: "Tool outcome" },
        durationMs: { type: "number", required: false, description: "Wall clock duration" },
        isError: { type: "boolean", required: false, description: "Whether execution failed" },
        errorCategory: { type: "string", required: false, cardinality: "low", description: "Normalized error category" },
      },
      events: {
        approval_pending: {
          description: "Tool execution is waiting for approval",
          attributes: { waitStartedAt: { type: "number", required: true, description: "Unix timestamp in milliseconds" } },
        },
        approval_decided: {
          description: "Tool approval received a decision",
          attributes: {
            approved: { type: "boolean", required: true, description: "Whether execution was approved" },
            waitDurationMs: { type: "number", required: true, description: "Approval wait duration" },
          },
        },
      },
      status: { default: "ok", errorWhen: "The tool fails, is rejected, or is aborted" },
    },
    "chalk.agent.approval": {
      description: "Human approval lifecycle for one tool call",
      parents: { kind: "spans", spans: ["chalk.agent.tool_call"] },
      startAttributes: {
        toolCallId: { type: "string", required: true, sensitive: true, cardinality: "high", description: "Opaque tool call identifier" },
        toolName: { type: "string", required: true, cardinality: "high", description: "Tool name" },
      },
      endAttributes: {
        status: { type: "string", required: false, values: ["approved", "rejected", "failed"], description: "Approval outcome" },
        durationMs: { type: "number", required: false, description: "Approval wait duration" },
      },
      status: { default: "ok", errorWhen: "Approval could not be obtained" },
    },
    "chalk.agent.compaction": {
      description: "Context compaction performed before an Agent run",
      parents: { kind: "root_or_external" },
      startAttributes: {
        sessionId: { type: "string", required: true, sensitive: true, cardinality: "high", description: "Stable session identifier" },
        modelId: { type: "string", required: true, cardinality: "high", description: "Model identifier" },
      },
      endAttributes: {
        status: { type: "string", required: false, values: ["completed", "skipped", "failed"], description: "Compaction outcome" },
        durationMs: { type: "number", required: false, description: "Wall clock duration" },
        tokensBefore: { type: "number", required: false, description: "Estimated tokens before compaction" },
        tokensRetained: { type: "number", required: false, description: "Estimated retained tokens" },
        messagesSummarized: { type: "number", required: false, description: "Messages included in summary" },
        errorCategory: { type: "string", required: false, cardinality: "low", description: "Normalized error category" },
      },
      status: { default: "ok", errorWhen: "Compaction fails" },
    },
    "chalk.agent.skill": {
      description: "One skill load or invocation",
      parents: { kind: "spans", spans: ["chalk.agent.run"] },
      startAttributes: { skillName: { type: "string", required: true, cardinality: "high", description: "Skill name" } },
      endAttributes: {
        status: { type: "string", required: false, values: ["completed", "failed"], description: "Skill outcome" },
        durationMs: { type: "number", required: false, description: "Wall clock duration" },
        errorCategory: { type: "string", required: false, cardinality: "low", description: "Normalized error category" },
      },
      status: { default: "ok", errorWhen: "Skill loading or invocation fails" },
    },
    "chalk.agent.mcp_call": {
      description: "One MCP connection, discovery, or tool call",
      parents: { kind: "spans", spans: ["chalk.agent.run", "chalk.agent.tool_call"] },
      startAttributes: {
        serverId: { type: "string", required: true, sensitive: true, cardinality: "high", description: "MCP server identifier" },
        operation: { type: "string", required: true, values: ["connect", "discover", "call", "disconnect"], description: "MCP operation" },
      },
      endAttributes: {
        status: { type: "string", required: false, values: ["completed", "failed"], description: "MCP outcome" },
        durationMs: { type: "number", required: false, description: "Wall clock duration" },
        toolCount: { type: "number", required: false, description: "Discovered tool count" },
        errorCategory: { type: "string", required: false, cardinality: "low", description: "Normalized error category" },
      },
      status: { default: "ok", errorWhen: "MCP operation fails" },
    },
    "chalk.agent.subagent": {
      description: "A child Agent run started by a parent Agent",
      parents: { kind: "spans", spans: ["chalk.agent.run"] },
      startAttributes: {
        childSessionId: { type: "string", required: true, sensitive: true, cardinality: "high", description: "Child session identifier" },
        parentSessionId: { type: "string", required: true, sensitive: true, cardinality: "high", description: "Parent session identifier" },
      },
      endAttributes: {
        status: { type: "string", required: false, values: ["completed", "aborted", "timed_out", "failed"], description: "Child run outcome" },
        durationMs: { type: "number", required: false, description: "Wall clock duration" },
        errorCategory: { type: "string", required: false, cardinality: "low", description: "Normalized error category" },
      },
      status: { default: "ok", errorWhen: "The child Agent fails" },
    },
  },
});

export type RuntimeTelemetryOptions = {
  context?: TelemetryContext;
  attributes?: SpanAttributes;
  onRunFinished?: (observation: AgentRunObservation) => void | Promise<void>;
};

export type AgentRunObservation = {
  status: "completed" | "aborted" | "failed";
  startedAt: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalCost?: number;
  errorCategory?: string;
};

/**
 * pi telemetry deliberately has no ambient current span. This adapter keeps
 * nesting explicit to one runtime instance while allowing tools to receive the
 * same context before a run has started.
 */
export class RuntimeTelemetryContext implements TelemetryContext {
  private activeContext?: TelemetryContext;

  constructor(private readonly baseContext: TelemetryContext) {}

  async startSpan<T>(
    options: { name: string; attributes?: SpanAttributes },
    callback: (span: import("@earendil-works/pi-telemetry").TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    const parent = this.activeContext ?? this.baseContext;
    return parent.startSpan(options, async (span) => {
      const previous = this.activeContext;
      this.activeContext = span;
      try {
        return await callback(span);
      } finally {
        this.activeContext = previous;
      }
    });
  }
}

export function createRuntimeTelemetryContext(
  context: TelemetryContext = NOOP_TELEMETRY_CONTEXT,
) {
  return new RuntimeTelemetryContext(context);
}

export const defaultRuntimeTelemetry: Required<Pick<RuntimeTelemetryOptions, "context">> = {
  context: NOOP_TELEMETRY_CONTEXT,
};
