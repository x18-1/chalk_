import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import type { TelemetryContext } from "@earendil-works/pi-telemetry";

export type ToolSource = "builtin" | "chalk" | "mcp" | "subagent";

export type ToolSummary = {
  name: string;
  label: string;
  description: string;
  source: ToolSource;
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

export interface ApprovalPort {
  request(
    request: ToolApprovalRequest,
    signal?: AbortSignal,
    onPending?: () => void,
  ): Promise<{ approved: boolean; reason?: string }>;
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
  requiresApproval?:
    | boolean
    | ApprovalPredicate<TParameters>;
  executionMode?: "sequential" | "parallel";
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
};

function summaryRequiresApproval(tool: RuntimeTool<any>) {
  return typeof tool.requiresApproval === "function"
    ? true
    : tool.requiresApproval === true;
}

async function requiresApproval(
  tool: RuntimeTool<any>,
  args: unknown,
  options: CreateAgentToolsOptions,
  signal?: AbortSignal,
) {
  const mode = options.approvalModes?.get(tool.name) ?? "default";
  if (mode === "always") return true;
  if (mode === "never") return false;
  if (typeof tool.requiresApproval === "function") {
    return tool.requiresApproval(args, options.context, signal);
  }
  return tool.requiresApproval === true;
}

function toAgentTool(
  tool: RuntimeTool<any>,
  options: CreateAgentToolsOptions,
): AgentTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    executionMode: tool.executionMode,
    async execute(toolCallId, args, signal, onUpdate) {
      const executeTool = async (span?: import("@earendil-works/pi-telemetry").TelemetrySpan) => {
        if (await requiresApproval(tool, args, options, signal)) {
        if (!options.approval) {
          throw new Error(
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
          if (!decision.approved) throw new Error(decision.reason ?? `Tool ${tool.name} was rejected`);
          return decision;
        };
        if (options.telemetry) {
          await options.telemetry.startSpan(
            { name: "chalk.agent.approval", attributes: { toolCallId, toolName: tool.name } },
            requestApproval,
          );
        } else {
          await requestApproval();
        }
      }

        const result = await tool.execute(args, options.context, signal, onUpdate);
        span?.setAttributes({ status: "completed" });
        return result;
      };
      if (!options.telemetry) return executeTool();
      return options.telemetry.startSpan(
        { name: "chalk.agent.tool_call", attributes: { toolCallId, toolName: tool.name, source: tool.source } },
        async (span) => {
          const startedAt = Date.now();
          try {
            const result = await executeTool(span);
            span.setAttributes({ durationMs: Date.now() - startedAt });
            return result;
          } catch (error) {
            span.setAttributes({ status: /reject|approval/i.test(error instanceof Error ? error.message : "") ? "rejected" : "failed", durationMs: Date.now() - startedAt, errorCategory: error instanceof Error ? error.name : "unknown" });
            span.setStatus({ status: "error", error: { name: error instanceof Error ? error.name : "Error", message: "Tool execution failed" } });
            throw error;
          }
        },
      );
    },
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, RuntimeTool<any>>();

  constructor(tools: readonly RuntimeTool<any>[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: RuntimeTool<any>) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  list(): ToolSummary[] {
    return Array.from(this.tools.values(), (tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      source: tool.source,
      requiresApproval: summaryRequiresApproval(tool),
    }));
  }

  createAgentTools(options: CreateAgentToolsOptions): AgentTool[] {
    return Array.from(this.tools.values())
      .filter(
        (tool) =>
          !options.enabledToolNames || options.enabledToolNames.has(tool.name),
      )
      .map((tool) => toAgentTool(tool, options));
  }
}
