import { Type } from "typebox";
import { InMemoryTelemetryContext } from "@earendil-works/pi-telemetry";
import { describe, expect, it, vi } from "vitest";

import {
  ToolRegistry,
  ToolExecutionError,
  ToolErrorChannel,
  type RuntimeTool,
} from "../../src/tools/tool-registry";
import { createRuntimeTelemetryContext } from "../../src/telemetry/telemetry";

const parameters = Type.Object({ value: Type.String() });

function createTool(requiresApproval: RuntimeTool<typeof parameters>["requiresApproval"] = true) {
  return {
    name: "test_tool",
    label: "Test tool",
    description: "A test tool",
    parameters,
    source: "chalk",
    effects: ["write" as const],
    approvalPolicy: "required" as const,
    defaultEnabled: true,
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

  it("does not let a never override bypass the tool approval floor", async () => {
    const request = vi.fn(async () => ({ approved: true }));
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "changed" }],
      details: {},
    }));
    const registry = new ToolRegistry([{
      ...createTool(),
      execute,
    }]);
    const [tool] = registry.createAgentTools({
      context: { ownerId: "student-1", sessionId: "session-1" },
      approval: { request },
      approvalModes: new Map([["test_tool", "never"]]),
    });

    await tool!.execute("call-floor", { value: "ok" });

    expect(request).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("times out a tool and aborts its implementation", async () => {
    const aborted = vi.fn();
    const registry = new ToolRegistry([{
      ...createTool(false),
      effects: ["read" as const],
      approvalPolicy: "none" as const,
      limits: { timeoutMs: 10 },
      async execute(_args, _context, signal) {
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => {
            aborted();
            resolve();
          }, { once: true });
        });
        throw new Error("implementation observed abort");
      },
    }]);
    const [tool] = registry.createAgentTools({
      context: { ownerId: "student-1", sessionId: "session-1" },
    });

    await expect(tool!.execute("call-timeout", { value: "ok" }))
      .rejects.toMatchObject({ code: "timed_out" });
    expect(aborted).toHaveBeenCalledOnce();
  });

  it("caps text content and marks the result as truncated", async () => {
    const registry = new ToolRegistry([{
      ...createTool(false),
      effects: ["read" as const],
      approvalPolicy: "none" as const,
      limits: { maxResultCharacters: 12 },
      async execute() {
        return {
          content: [{ type: "text" as const, text: "0123456789ABCDEFGHIJ" }],
          details: {},
        };
      },
    }]);
    const [tool] = registry.createAgentTools({
      context: { ownerId: "student-1", sessionId: "session-1" },
    });

    const result = await tool!.execute("call-result", { value: "ok" });

    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text.length).toBeLessThanOrEqual(12);
    expect(result.details).toMatchObject({
      resultTruncated: { originalCharacters: 20, maxCharacters: 12 },
    });
  });

  it("rejects malformed tool definitions at registration", () => {
    expect(() => new ToolRegistry([{
      ...createTool(false),
      name: "bad name",
    }])).toThrow(/name/i);
  });

  it("classifies approval rejection without relying on message matching", async () => {
    const registry = new ToolRegistry([createTool()]);
    const [tool] = registry.createAgentTools({
      context: { ownerId: "student-1", sessionId: "session-1" },
      approval: { request: async () => ({ approved: false, reason: "no" }) },
    });

    await expect(tool!.execute("call-reject", { value: "ok" }))
      .rejects.toBeInstanceOf(ToolExecutionError);
    await expect(tool!.execute("call-reject-2", { value: "ok" }))
      .rejects.toMatchObject({ code: "approval_rejected" });
  });

  it("publishes a structured error observation for Pi's plain error result", async () => {
    const channel = new ToolErrorChannel();
    const registry = new ToolRegistry([{
      ...createTool(false),
      effects: ["read" as const],
      approvalPolicy: "none" as const,
      async execute() {
        throw new Error("provider wording may change");
      },
    }]);
    const [tool] = registry.createAgentTools({
      context: { ownerId: "student-1", sessionId: "session-1" },
      errorChannel: channel,
    });

    await expect(tool!.execute("call-error", { value: "ok" })).rejects.toMatchObject({ code: "execution_failed" });
    expect(channel.consume("call-error")).toEqual({
      toolCallId: "call-error",
      toolName: "test_tool",
      code: "execution_failed",
    });
  });
});
