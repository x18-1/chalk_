import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentRuntime } from "../../src/runtime/agent-runtime";
import { createJsonlSessionRepository } from "../../src/session/session-repository";
import { ToolRegistry } from "../../src/tools/tool-registry";
import {
  createSubagentTool,
  ForegroundSubagentExecutor,
  SUBAGENT_MAX_RESULT_CHARACTERS,
  SUBAGENT_TIMEOUT_MS,
} from "../../src/subagent/subagent-executor";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ForegroundSubagentExecutor", () => {
  it("rejects an empty task before creating a child session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-subagent-empty-task-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({ sessionsRoot: join(directory, "sessions"), cwd: directory });
    const executor = new ForegroundSubagentExecutor({
      sessions,
      createRuntime: vi.fn(),
    });
    await expect(executor.run(
      { task: "   " },
      { ownerId: "student-1", parentSessionId: "parent-1" },
    )).rejects.toMatchObject({ code: "invalid_arguments" });
  });
  it("runs a bounded child task in its own durable session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-subagent-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
    faux.setResponses([fauxAssistantMessage("公共边 AC 是关键条件。")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const started = vi.fn(async () => ({ id: "audit-1" }));
    const finished = vi.fn(async () => undefined);
    const executor = new ForegroundSubagentExecutor({
      sessions,
      audit: { started, finished },
      createRuntime: ({ session }) =>
        createAgentRuntime({
          session,
          llm: { models, model: faux.getModel(), thinkingLevel: "off" },
          systemPrompt: "只分析指定条件。",
        }),
    });

    const result = await executor.run(
      { task: "找出证明中的关键条件" },
      { ownerId: "student-1", parentSessionId: "parent-1" },
    );

    expect(result.status).toBe("completed");
    expect(result.output).toBe("公共边 AC 是关键条件。");
    expect(started).toHaveBeenCalledOnce();
    expect(finished).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-1" }),
    );
    await expect(
      sessions.open("student-1", result.childSessionId),
    ).resolves.toBeDefined();
  });

  it("keeps a completed child result when audit finalization fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-subagent-audit-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
    faux.setResponses([fauxAssistantMessage("The child result is still usable.")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const executor = new ForegroundSubagentExecutor({
      sessions,
      audit: {
        started: async () => ({ id: "audit-1" }),
        finished: async () => { throw new Error("audit storage unavailable"); },
      },
      createRuntime: ({ session }) => createAgentRuntime({
        session,
        llm: { models, model: faux.getModel(), thinkingLevel: "off" },
        systemPrompt: "Return the requested result.",
      }),
    });

    const result = await executor.run(
      { task: "Return a deterministic answer" },
      { ownerId: "student-1", parentSessionId: "parent-1" },
    );

    expect(result).toMatchObject({
      status: "completed",
      output: "The child result is still usable.",
    });
  });

  it("reports a failed child run as a failed Tool call", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-subagent-failure-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const finished = vi.fn(async () => undefined);
    const executor = new ForegroundSubagentExecutor({
      sessions,
      audit: { started: async () => ({ id: "audit-1" }), finished },
      createRuntime: async () => { throw new Error("provider secret should stay internal"); },
    });
    const registry = new ToolRegistry([createSubagentTool(executor)]);
    const [tool] = registry.createAgentTools({
      context: { ownerId: "student-1", sessionId: "parent-1" },
      enabledToolNames: new Set(["run_subagent"]),
      approval: { request: async () => ({ approved: true }) },
    });

    await expect(tool!.execute(
      "subagent-call-1",
      { task: "Handle a bounded task" },
      new AbortController().signal,
      () => undefined,
    )).rejects.toMatchObject({ code: "execution_failed" });
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ status: "failed", error: "runtime_failed" }),
    }));
    expect(JSON.stringify(finished.mock.calls)).not.toContain("provider secret");
  });

  it("bounds the child text returned to its parent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-subagent-output-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({ sessionsRoot: join(directory, "sessions"), cwd: directory });
    const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
    faux.setResponses([fauxAssistantMessage("x".repeat(SUBAGENT_MAX_RESULT_CHARACTERS + 100))]);
    const models = createModels();
    models.setProvider(faux.provider);
    const executor = new ForegroundSubagentExecutor({
      sessions,
      createRuntime: ({ session }) => createAgentRuntime({
        session,
        llm: { models, model: faux.getModel(), thinkingLevel: "off" },
        systemPrompt: "Return bounded text.",
      }),
    });

    const result = await executor.run(
      { task: "Return a long result" },
      { ownerId: "student-1", parentSessionId: "parent-1" },
    );

    expect(result.status).toBe("completed");
    expect(result.output).toHaveLength(SUBAGENT_MAX_RESULT_CHARACTERS);
  });

  it("records the Tool deadline as a timed out child run", async () => {
    vi.useFakeTimers();
    const directory = await mkdtemp(join(tmpdir(), "chalk-subagent-timeout-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({ sessionsRoot: join(directory, "sessions"), cwd: directory });
    let factoryStarted!: () => void;
    const started = new Promise<void>((resolve) => { factoryStarted = resolve; });
    const finished = vi.fn(async () => undefined);
    const executor = new ForegroundSubagentExecutor({
      sessions,
      audit: { started: async () => ({ id: "audit-1" }), finished },
      createRuntime: () => {
        factoryStarted();
        return new Promise(() => undefined);
      },
    });
    const registry = new ToolRegistry([createSubagentTool(executor)]);
    const [tool] = registry.createAgentTools({
      context: { ownerId: "student-1", sessionId: "parent-1" },
      enabledToolNames: new Set(["run_subagent"]),
      approval: { request: async () => ({ approved: true }) },
    });

    try {
      const call = tool!.execute(
        "subagent-timeout-1",
        { task: "Wait forever" },
        new AbortController().signal,
        () => undefined,
      );
      const timedOut = expect(call).rejects.toMatchObject({ code: "timed_out" });
      await started;
      await vi.advanceTimersByTimeAsync(SUBAGENT_TIMEOUT_MS);
      await timedOut;
      await vi.waitFor(() => expect(finished).toHaveBeenCalledWith(expect.objectContaining({
        result: expect.objectContaining({ status: "timed_out", error: "timed_out" }),
      })));
    } finally {
      vi.useRealTimers();
    }
  });

  it("records parent cancellation without exposing the abort reason", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-subagent-cancel-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({ sessionsRoot: join(directory, "sessions"), cwd: directory });
    let factoryStarted!: () => void;
    const started = new Promise<void>((resolve) => { factoryStarted = resolve; });
    const finished = vi.fn(async () => undefined);
    const executor = new ForegroundSubagentExecutor({
      sessions,
      audit: { started: async () => ({ id: "audit-1" }), finished },
      createRuntime: () => {
        factoryStarted();
        return new Promise(() => undefined);
      },
    });
    const registry = new ToolRegistry([createSubagentTool(executor)]);
    const [tool] = registry.createAgentTools({
      context: { ownerId: "student-1", sessionId: "parent-1" },
      enabledToolNames: new Set(["run_subagent"]),
      approval: { request: async () => ({ approved: true }) },
    });
    const controller = new AbortController();
    const call = tool!.execute(
      "subagent-cancel-1",
      { task: "Wait for cancellation" },
      controller.signal,
      () => undefined,
    );
    const cancelled = expect(call).rejects.toMatchObject({ code: "cancelled" });
    await started;
    controller.abort(new Error("private parent reason"));

    await cancelled;
    await vi.waitFor(() => expect(finished).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ status: "aborted", error: "cancelled" }),
    })));
    expect(JSON.stringify(finished.mock.calls)).not.toContain("private parent reason");
  });

  it("exposes only the bounded task and never returns a local session path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-subagent-contract-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({ sessionsRoot: join(directory, "sessions"), cwd: directory });
    const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
    faux.setResponses([fauxAssistantMessage("A concise child result.")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const executor = new ForegroundSubagentExecutor({
      sessions,
      createRuntime: ({ session }) => createAgentRuntime({
        session,
        llm: { models, model: faux.getModel(), thinkingLevel: "off" },
        systemPrompt: "Handle one bounded task.",
      }),
    });
    const tool = createSubagentTool(executor);

    expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual(["task"]);
    const result = await tool.execute(
      { task: "Check one fact" },
      { ownerId: "student-1", sessionId: "parent-1" },
    );
    expect(result.content).toEqual([{ type: "text", text: "A concise child result." }]);
    expect(result.details).not.toHaveProperty("childSessionPath");
  });
});
