import {
  defineTelemetrySchema,
  NOOP_TELEMETRY_CONTEXT,
  type SpanAttributes,
  type TelemetryContext,
} from "@earendil-works/pi-telemetry";

export const chalkTelemetrySchema = defineTelemetrySchema({
  version: 1,
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
      },
      status: { default: "ok", errorWhen: "The run fails or returns an error status" },
    },
  },
});

export type RuntimeTelemetryOptions = {
  context?: TelemetryContext;
  attributes?: SpanAttributes;
};

export const defaultRuntimeTelemetry: Required<Pick<RuntimeTelemetryOptions, "context">> = {
  context: NOOP_TELEMETRY_CONTEXT,
};
