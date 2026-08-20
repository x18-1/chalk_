import { Type } from "typebox";
import { InMemoryTelemetryContext } from "@earendil-works/pi-telemetry";
import { describe, expect, it, vi } from "vitest";

import { ToolRegistry, type RuntimeTool } from "../../src/tools/tool-registry";
import { createRuntimeTelemetryContext } from "../../src/telemetry/telemetry";

const parameters = Type.Object({ value: Type.String() });

function createTool(requiresApproval: RuntimeTool<typeof parameters>["requiresApproval"] = true) {
  return {
    name: "test_tool",
    label: "Test tool",
    description: "A test tool",
    parameters,
    source: "chalk",
    requiresApproval,
    async execute(args) {
      return {
        content: [{ type: "text" as const, text: args.value }],
        details: { value: args.value },
      };
    },
  } satisfies RuntimeTool<typeof parameters>;
}

describe("ToolRegistry", () => {
  it("fails closed and emits a pending update before approval", async () => {
    const request = vi.fn(async (_request, _signal, onPending) => {
      onPending?.();
      return { approved: true };
    });
    const update = vi.fn();
    const telemetry = new InMemoryTelemetryContext();
    const [tool] = new ToolRegistry([createTool()]).createAgentTools({
      context: { ownerId: "student-1", sessionId: "session-1" },
      approval: { request },
      telemetry: createRuntimeTelemetryContext(telemetry),
    });

    const result = await tool!.execute(
      "call-1",
      { value: "ok" },
      undefined,
      update,
    );

    expect(request).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ type: "approval_pending" }),
      }),
    );
    expect(result.content[0]).toMatchObject({ type: "text", text: "ok" });
    const spans = telemetry.getSpans();
    const toolSpan = spans.find((span) => span.name === "chalk.agent.tool_call");
    expect(spans.find((span) => span.name === "chalk.agent.approval")).toEqual(
      expect.objectContaining({ parentId: toolSpan?.id }),
    );
    expect(toolSpan?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "approval_pending" }),
      expect.objectContaining({ name: "approval_decided", attributes: expect.objectContaining({ approved: true }) }),
    ]));
  });

  it("applies explicit approval modes and enabled tool names", async () => {
    const request = vi.fn(async () => ({ approved: true }));
    const registry = new ToolRegistry([createTool(false)]);
    expect(
      registry.createAgentTools({
        context: { ownerId: "student-1", sessionId: "session-1" },
        enabledToolNames: new Set(),
      }),
    ).toHaveLength(0);

    const [tool] = registry.createAgentTools({
      context: { ownerId: "student-1", sessionId: "session-1" },
      approval: { request },
      approvalModes: new Map([["test_tool", "always"]]),
    });
    await tool!.execute("call-1", { value: "ok" });
    expect(request).toHaveBeenCalledOnce();
  });
});
