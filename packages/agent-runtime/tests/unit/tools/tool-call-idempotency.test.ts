import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";

import {
  ToolExecutionError,
  ToolRegistry,
  type RuntimeTool,
} from "../../../src/tools/tool-registry";

const parameters = Type.Object({ value: Type.String() });

function createReadTool(execute: RuntimeTool<typeof parameters>["execute"]) {
  return {
    name: "idempotent_tool",
    label: "Idempotent tool",
    description: "A tool used to verify tool-call idempotency.",
    parameters,
    source: "chalk" as const,
    effects: ["read"] as const,
    approvalPolicy: "none" as const,
    defaultEnabled: true,
    execute,
  } satisfies RuntimeTool<typeof parameters>;
}

function createAgentTool(tool: RuntimeTool<typeof parameters>) {
  const [agentTool] = new ToolRegistry([tool]).createAgentTools({
    context: { ownerId: "owner-1", sessionId: "session-1" },
  });
  return agentTool!;
}

describe("tool-call idempotency", () => {
  it("executes a toolCallId once and returns the original result on retry", async () => {
    const execute = vi.fn(async (args: { value: string }) => ({
      content: [{ type: "text" as const, text: args.value }],
      details: { value: args.value },
    }));
    const tool = createAgentTool(createReadTool(execute));

    const first = await tool.execute("call-1", { value: "ok" });
    const second = await tool.execute("call-1", { value: "ok" });

    expect(execute).toHaveBeenCalledOnce();
    expect(second).toEqual(first);
  });

  it("shares one in-flight promise for concurrent re-entry", async () => {
    let release!: () => void;
    const execute = vi.fn(async (args: { value: string }) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        content: [{ type: "text" as const, text: args.value }],
        details: undefined,
      };
    });
    const tool = createAgentTool(createReadTool(execute));

    const first = tool.execute("call-concurrent", { value: "ok" });
    const second = tool.execute("call-concurrent", { value: "ok" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { content: [{ type: "text", text: "ok" }], details: undefined },
      { content: [{ type: "text", text: "ok" }], details: undefined },
    ]);
  });

  it("fails closed when a toolCallId is reused with different arguments", async () => {
    const execute = vi.fn(async (args: { value: string }) => ({
      content: [{ type: "text" as const, text: args.value }],
      details: undefined,
    }));
    const tool = createAgentTool(createReadTool(execute));

    await tool.execute("call-conflict", { value: "first" });
    await expect(tool.execute("call-conflict", { value: "second" }))
      .rejects.toMatchObject({
        code: "tool_call_conflict",
      });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not repeat a side effect after the first execution fails", async () => {
    const failure = new ToolExecutionError("execution_failed", "provider failed");
    const execute = vi.fn(async () => {
      throw failure;
    });
    const tool = createAgentTool(createReadTool(execute));

    const first = tool.execute("call-failure", { value: "ok" });
    const second = tool.execute("call-failure", { value: "ok" });

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledOnce();
  });
});
