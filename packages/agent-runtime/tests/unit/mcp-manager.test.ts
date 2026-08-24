import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { McpManager } from "../../src/mcp/mcp-manager";
import { createAgentRuntime, type AgentRuntimeEvent } from "../../src/runtime/agent-runtime";
import { createJsonlSessionRepository } from "../../src/session/session-repository";
import { ToolRegistry } from "../../src/tools/tool-registry";

const temporaryDirectories: string[] = [];
const fixturePath = resolve("tests/fixtures/mcp-server.mjs");

async function createFixtureManager(options?: { callTimeoutMs?: number }) {
  const directory = await mkdtemp(join(tmpdir(), "chalk-mcp-test-"));
  temporaryDirectories.push(directory);
  const exitFile = join(directory, "fixture-exited");
  const manager = new McpManager([{ 
    id: "fixture",
    name: "fixture",
    transport: "stdio",
    command: process.execPath,
    args: [fixturePath],
    env: { MCP_FIXTURE_EXIT_FILE: exitFile },
    enabled: true,
  }], options);
  return { manager, exitFile };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("McpManager", () => {
  it("discovers and invokes a real local MCP tool", async () => {
    const { manager } = await createFixtureManager();
    try {
      const discovered = await manager.connect("fixture");
      expect(discovered).toContainEqual(expect.objectContaining({
        name: "mcp__fixture__echo_math",
        source: "mcp",
        requiresApproval: false,
      }));

      const [tool] = manager.tools(new Set(["fixture"]));
      const result = await tool!.execute(
        { left: 7, right: 5 },
        { ownerId: "student-1", sessionId: "session-1" },
      );
      expect(result.content).toEqual([{ type: "text", text: "7 + 5 = 12" }]);
      expect(result.details).toMatchObject({
        serverId: "fixture",
        toolName: "echo_math",
        structuredContent: { sum: 12 },
      });
    } finally {
      await manager.close();
    }
  });

  it("reads a text resource through the MCP client", async () => {
    const { manager } = await createFixtureManager();
    try {
      const result = await manager.readResource(
        "fixture",
        "chalk://fixture/lesson-notes",
      );
      expect(result.contents).toEqual([expect.objectContaining({
        uri: "chalk://fixture/lesson-notes",
        mimeType: "text/plain",
        text: "第一行资源内容\n第二行资源内容\n第三行资源内容\n",
      })]);
    } finally {
      await manager.close();
    }
  });

  it("discovers resources through the proxy search", async () => {
    const { manager } = await createFixtureManager();
    try {
      const [proxy] = manager.proxyTools();
      const result = await proxy!.execute(
        { action: "search", query: "lesson" },
        { ownerId: "student-1", sessionId: "session-1" },
      );
      expect(JSON.stringify(result)).toContain("chalk://fixture/lesson-notes");
      expect(result.details).toMatchObject({ resourceCount: 1 });
    } finally {
      await manager.close();
    }
  });

  it("reconnects a previously discovered read-only tool after disconnect", async () => {
    const { manager } = await createFixtureManager();
    try {
      await manager.connect("fixture");
      const [tool] = manager.tools();
      await manager.disconnect("fixture");

      const result = await tool!.execute(
        { left: 2, right: 3 },
        { ownerId: "student-1", sessionId: "session-1" },
      );
      expect(result.content).toEqual([{ type: "text", text: "2 + 3 = 5" }]);
      expect(manager.statuses()[0]).toMatchObject({ state: "connected", toolCount: 1 });
    } finally {
      await manager.close();
    }
  });

  it("closes its stdio child process", async () => {
    const { manager, exitFile } = await createFixtureManager();
    await manager.connect("fixture");

    await manager.close();

    await expect(access(exitFile)).resolves.toBeUndefined();
    await expect(readFile(exitFile, "utf8")).resolves.toBe("closed");
  });

  it("streams a real MCP tool call through the Agent and persists its result", async () => {
    const { manager } = await createFixtureManager();
    const directory = await mkdtemp(join(tmpdir(), "chalk-mcp-agent-test-"));
    temporaryDirectories.push(directory);
    try {
      const registry = new ToolRegistry(manager.proxyTools());
      const tools = registry.createAgentTools({
        context: { ownerId: "student-1", sessionId: "mcp-agent-session" },
      });
      const sessions = createJsonlSessionRepository({
        sessionsRoot: join(directory, "sessions"),
        cwd: directory,
      });
      const session = await sessions.create({ ownerId: "student-1" });
      const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall(
            "mcp__fixture__fixture",
            { action: "search", query: "math" },
            { id: "mcp-search-1" },
          ),
          { stopReason: "toolUse" },
        ),
        (context) => {
          const searchResult = context.messages.find(
            (message) => message.role === "toolResult" && message.toolCallId === "mcp-search-1",
          );
          expect(searchResult).toMatchObject({
            toolName: "mcp__fixture__fixture",
            isError: false,
          });
          expect(JSON.stringify(searchResult)).toContain("echo_math");
          return fauxAssistantMessage(
            fauxToolCall(
              "mcp__fixture__fixture",
              {
                action: "call",
                tool: "echo_math",
                arguments: { left: 8, right: 13 },
              },
              { id: "mcp-call-1" },
            ),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const toolResult = context.messages.find(
            (message) => message.role === "toolResult" && message.toolCallId === "mcp-call-1",
          );
          expect(toolResult).toMatchObject({
            toolName: "mcp__fixture__fixture",
            content: [{ type: "text", text: "8 + 13 = 21" }],
            isError: false,
          });
          return fauxAssistantMessage("工具验证结果是 21。");
        },
      ]);
      const models = createModels();
      models.setProvider(faux.provider);
      const runtime = await createAgentRuntime({
        session,
        llm: { models, model: faux.getModel(), thinkingLevel: "off" },
        systemPrompt: "Use the deterministic MCP tool.",
        tools,
      });
      const events: AgentRuntimeEvent[] = [];

      const result = await runtime.run("Use the MCP tool to add 8 and 13.", (event) => {
        events.push(event);
      });

      expect(result.status).toBe("completed");
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "tool_started",
          toolCallId: "mcp-call-1",
          toolName: "mcp__fixture__fixture",
        }),
        expect.objectContaining({
          type: "tool_finished",
          toolCallId: "mcp-call-1",
          toolName: "mcp__fixture__fixture",
          isError: false,
        }),
      ]));
      expect(result.message?.role).toBe("assistant");
      if (result.message?.role !== "assistant") {
        throw new Error("Expected the Agent run to finish with an assistant message");
      }
      expect(result.message.content).toContainEqual({
        type: "text",
        text: "工具验证结果是 21。",
      });

      const reopened = await sessions.open("student-1", session.descriptor.id);
      expect(await reopened.getMessages()).toContainEqual(expect.objectContaining({
        role: "toolResult",
        toolCallId: "mcp-call-1",
        toolName: "mcp__fixture__fixture",
        content: [{ type: "text", text: "8 + 13 = 21" }],
        isError: false,
      }));
    } finally {
      await manager.close();
    }
  });

  it("times out a slow MCP tool call", async () => {
    const { manager } = await createFixtureManager({ callTimeoutMs: 50 });
    try {
      await manager.connect("fixture");
      const [tool] = manager.tools();

      await expect(tool!.execute(
        { left: 1, right: 2, delayMs: 5_000 },
        { ownerId: "student-1", sessionId: "session-1" },
      )).rejects.toThrow(/timed out|timeout/i);
    } finally {
      await manager.close();
    }
  });

  it("aborts an in-flight MCP tool call", async () => {
    const { manager } = await createFixtureManager({ callTimeoutMs: 5_000 });
    try {
      await manager.connect("fixture");
      const [tool] = manager.tools();
      const controller = new AbortController();
      const call = tool!.execute(
        { left: 1, right: 2, delayMs: 5_000 },
        { ownerId: "student-1", sessionId: "session-1" },
        controller.signal,
      );

      controller.abort();

      await expect(call).rejects.toThrow(/abort/i);
    } finally {
      await manager.close();
    }
  });

  it("records a failed connection without retaining tools", async () => {
    const manager = new McpManager([{
      id: "missing",
      name: "missing",
      transport: "stdio",
      command: resolve("tests/fixtures/does-not-exist"),
      enabled: true,
    }]);

    await expect(manager.connect("missing")).rejects.toThrow();
    expect(manager.statuses()).toEqual([
      expect.objectContaining({ id: "missing", state: "error", toolCount: 0 }),
    ]);
    expect(manager.tools()).toEqual([]);
    await manager.close();
  });

  it("rejects credential-bearing URLs at the manager seam", async () => {
    const manager = new McpManager([{
      id: "unsafe",
      name: "unsafe",
      transport: "http",
      url: "https://student:secret@example.test/mcp",
      enabled: true,
    }]);

    await expect(manager.connect("unsafe")).rejects.toThrow(
      "MCP server unsafe URL must not contain credentials",
    );
    expect(manager.statuses()[0]).toMatchObject({ state: "error", toolCount: 0 });
    await manager.close();
  });
});
