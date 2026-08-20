import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { InMemoryTelemetryContext } from "@earendil-works/pi-telemetry";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createJsonlSessionRepository } from "../../src/session/session-repository";
import { createAgentRuntime } from "../../src/runtime/agent-runtime";
import { createRuntimeTelemetryContext } from "../../src/telemetry/telemetry";
import { ToolRegistry, type RuntimeTool } from "../../src/tools/tool-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AgentRuntime", () => {
  it("streams a model response and durably appends the completed turn", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });

    const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
    faux.setResponses([fauxAssistantMessage("先观察公共边 AC。")]);
    const models = createModels();
    models.setProvider(faux.provider);

    const runtime = await createAgentRuntime({
      session,
      models,
      model: { providerId: faux.provider.id, modelId: faux.getModel().id, thinkingLevel: "off" },
      systemPrompt: "你是 Chalk 数学老师。",
    });
    const deltas: string[] = [];

    const result = await runtime.run("为什么要连接 AC？", (event) => {
      if (event.type === "text_delta") deltas.push(event.delta);
    });

    expect(result.status).toBe("completed");
    expect(deltas.join("")).toBe("先观察公共边 AC。");

    const reopened = await sessions.open("student-1", session.descriptor.id);
    const messages = await reopened.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
  });

  it("records a run and each model request without recording prompt content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({ sessionsRoot: join(directory, "sessions"), cwd: directory });
    const session = await sessions.create({ ownerId: "student-1" });
    const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
    faux.setResponses([fauxAssistantMessage("先观察已知条件。")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const telemetry = new InMemoryTelemetryContext();
    const runtimeTelemetry = createRuntimeTelemetryContext(telemetry);
    const runtime = await createAgentRuntime({
      session,
      models,
      model: { providerId: faux.provider.id, modelId: faux.getModel().id, thinkingLevel: "off" },
      systemPrompt: "test",
      telemetry: {
        context: runtimeTelemetry,
        attributes: { ownerId: "student-1", sessionId: session.descriptor.id },
      },
    });

    await runtime.run("PRIVATE_STUDENT_PROMPT");

    const spans = telemetry.getSpans();
    const runSpan = spans.find((span) => span.name === "chalk.agent.run");
    const modelSpan = spans.find((span) => span.name === "chalk.agent.model_call");
    expect(runSpan).toEqual(expect.objectContaining({ parentId: null }));
    expect(modelSpan).toEqual(expect.objectContaining({
      parentId: runSpan?.id,
      attributes: expect.objectContaining({ status: "completed", finishReason: "stop" }),
    }));
    expect(JSON.stringify(spans)).not.toContain("PRIVATE_STUDENT_PROMPT");
  });

  it("fails closed when the selected model does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });

    await expect(
      createAgentRuntime({
        session,
        models: createModels(),
        model: { providerId: "missing", modelId: "missing", thinkingLevel: "off" },
        systemPrompt: "test",
      }),
    ).rejects.toThrow("Model missing/missing is not available");
  });

  it("applies the selected thinking level to the provider request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });
    const observeReasoning = vi.fn();
    const faux = fauxProvider({
      models: [{ id: "reasoning-model", reasoning: true }],
    });
    faux.setResponses([
      (_context, options) => {
        observeReasoning(options?.reasoning);
        return fauxAssistantMessage("先列出已知条件。");
      },
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const runtime = await createAgentRuntime({
      session,
      models,
      model: {
        providerId: faux.provider.id,
        modelId: faux.getModel().id,
        thinkingLevel: "high",
      },
      systemPrompt: "你是 Chalk 数学老师。",
    });

    await runtime.run("怎么开始？");

    expect(observeReasoning).toHaveBeenCalledWith("high");
  });

  it("rejects a thinking level unsupported by the selected model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });
    const faux = fauxProvider({ models: [{ id: "plain-model", reasoning: false }] });
    const models = createModels();
    models.setProvider(faux.provider);

    await expect(createAgentRuntime({
      session,
      models,
      model: {
        providerId: faux.provider.id,
        modelId: faux.getModel().id,
        thinkingLevel: "high",
      },
      systemPrompt: "test",
    })).rejects.toThrow("Thinking level high is not supported");
  });

  it("aborts an active stream and persists the aborted outcome", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });
    const faux = fauxProvider({
      tokensPerSecond: 1,
      tokenSize: { min: 1, max: 1 },
    });
    faux.setResponses([fauxAssistantMessage("这是一段不会完整返回的长回答。")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const runtime = await createAgentRuntime({
      session,
      models,
      model: { providerId: faux.provider.id, modelId: faux.getModel().id, thinkingLevel: "off" },
      systemPrompt: "test",
    });

    const result = await runtime.run("停止这次回答", (event) => {
      if (event.type === "run_started") runtime.abort();
    });

    expect(result.status).toBe("aborted");
    const reopened = await sessions.open("student-1", session.descriptor.id);
    expect(await reopened.getMessages()).toContainEqual(expect.objectContaining({
      role: "assistant",
      stopReason: "aborted",
    }));
  });

  it("injects a steering message into the active run and persists it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });
    const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
    faux.setResponses([
      fauxAssistantMessage("先按原思路分析。"),
      (context) => {
        expect(context.messages).toContainEqual(expect.objectContaining({
          role: "user",
          content: [{ type: "text", text: "改用画图提示，不要直接给答案" }],
        }));
        return fauxAssistantMessage("好，我们改用图形关系继续。 ");
      },
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const runtime = await createAgentRuntime({
      session,
      models,
      model: { providerId: faux.provider.id, modelId: faux.getModel().id, thinkingLevel: "off" },
      systemPrompt: "test",
    });
    let steered = false;

    const result = await runtime.run("帮我分析这道题", (event) => {
      if (event.type === "text_delta" && !steered) {
        steered = true;
        runtime.steer("改用画图提示，不要直接给答案");
      }
    });

    expect(result.status).toBe("completed");
    const reopened = await sessions.open("student-1", session.descriptor.id);
    expect(await reopened.getMessages()).toContainEqual(expect.objectContaining({
      role: "user",
      content: [{ type: "text", text: "改用画图提示，不要直接给答案" }],
    }));
  });

  it("restores the compaction summary together with its retained tail", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });
    await session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "早期条件：" + "甲".repeat(4_000) }],
      timestamp: 1,
    });
    await session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "最近必须保留：连接 AC" }],
      timestamp: 2,
    });
    const faux = fauxProvider({
      models: [{ id: "compact-model", contextWindow: 1_000 }],
    });
    faux.setResponses([fauxAssistantMessage("已总结早期条件。")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const options = {
      session,
      models,
      model: { providerId: faux.provider.id, modelId: faux.getModel().id, thinkingLevel: "off" as const },
      systemPrompt: "test",
      compaction: { enabled: true, reserveTokens: 200, keepRecentTokens: 1 },
    };

    const firstRuntime = await createAgentRuntime(options);
    expect(firstRuntime.getMessages().map((message) => message.role)).toEqual([
      "compactionSummary",
      "user",
    ]);

    const restoredRuntime = await createAgentRuntime(options);
    expect(restoredRuntime.getMessages()).toEqual([
      expect.objectContaining({ role: "compactionSummary", summary: "已总结早期条件。" }),
      expect.objectContaining({
        role: "user",
        content: [{ type: "text", text: "最近必须保留：连接 AC" }],
      }),
    ]);
  });

  it("compacts by contextWindow when caller does not override keepRecentTokens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });
    const earlyText = "早期条件：SECRET_FACT_AB_EQUALS_AC。" + "甲".repeat(2_000);
    const recentText = "最近必须保留：连接 AC。" + "乙".repeat(1_200);
    await session.appendMessage({
      role: "user",
      content: [{ type: "text", text: earlyText }],
      timestamp: 1,
    });
    await session.appendMessage({
      role: "user",
      content: [{ type: "text", text: recentText }],
      timestamp: 2,
    });
    const faux = fauxProvider({
      models: [{ id: "compact-model", contextWindow: 1_024 }],
    });
    faux.setResponses([fauxAssistantMessage("已总结早期条件。")]);
    const models = createModels();
    models.setProvider(faux.provider);

    const runtime = await createAgentRuntime({
      session,
      models,
      model: { providerId: faux.provider.id, modelId: faux.getModel().id, thinkingLevel: "off" },
      systemPrompt: "test",
    });

    expect(runtime.getMessages()).toEqual([
      expect.objectContaining({ role: "compactionSummary", summary: "已总结早期条件。" }),
      expect.objectContaining({
        role: "user",
        content: [{ type: "text", text: recentText }],
      }),
    ]);
    expect(await session.getTranscript()).toEqual([
      expect.objectContaining({ content: [{ type: "text", text: earlyText }] }),
      expect.objectContaining({ content: [{ type: "text", text: recentText }] }),
    ]);
  });

  it("sends the compaction summary to the model instead of the dropped prefix", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });
    const earlyText = "早期条件：SECRET_FACT_AB_EQUALS_AC。" + "甲".repeat(2_000);
    const recentText = "最近必须保留：连接 AC。" + "乙".repeat(1_200);
    await session.appendMessage({
      role: "user",
      content: [{ type: "text", text: earlyText }],
      timestamp: 1,
    });
    await session.appendMessage({
      role: "user",
      content: [{ type: "text", text: recentText }],
      timestamp: 2,
    });
    const captured: string[] = [];
    const faux = fauxProvider({
      models: [{ id: "compact-model", contextWindow: 1_024 }],
    });
    faux.setResponses([
      fauxAssistantMessage("已总结早期条件。"),
      (context) => {
        captured.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("先写一个已知关系。");
      },
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const runtime = await createAgentRuntime({
      session,
      models,
      model: { providerId: faux.provider.id, modelId: faux.getModel().id, thinkingLevel: "off" },
      systemPrompt: "test",
    });

    const result = await runtime.run("验证压缩后的上下文");

    expect(result.status).toBe("completed");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain("已总结早期条件。");
    expect(captured[0]).toContain(recentText);
    expect(captured[0]).not.toContain("SECRET_FACT_AB_EQUALS_AC");
  });

  it("persists thinking blocks and tool results in the durable transcript", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create({ ownerId: "student-1" });
    const telemetry = new InMemoryTelemetryContext();
    const runtimeTelemetry = createRuntimeTelemetryContext(telemetry);
    const inspectParameters = Type.Object({ problem: Type.String() });
    const inspectProblem = {
      name: "inspect_problem_structure",
      label: "题目结构检查",
      description: "整理题目结构",
      parameters: inspectParameters,
      source: "chalk",
      async execute() {
        return {
          content: [{ type: "text" as const, text: "已识别三条已知关系。" }],
          details: {},
        };
      },
    } satisfies RuntimeTool<typeof inspectParameters>;
    const tools = new ToolRegistry([inspectProblem]).createAgentTools({
      context: { ownerId: "student-1", sessionId: session.descriptor.id },
      telemetry: runtimeTelemetry,
      approvalModes: new Map([["inspect_problem_structure", "never"]]),
    });
    const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxThinking("先识别已知条件，再检查可以直接使用的关系。"),
          fauxToolCall(
            "inspect_problem_structure",
            { problem: "三角形 ABC 中 AB = AC" },
            { id: "inspect-1" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("现在先写出最直接的一组等量关系。"),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const runtime = await createAgentRuntime({
      session,
      models,
      model: { providerId: faux.provider.id, modelId: faux.getModel().id, thinkingLevel: "off" },
      systemPrompt: "你是 Chalk 数学老师。",
      tools,
      telemetry: {
        context: runtimeTelemetry,
        attributes: { ownerId: "student-1", sessionId: session.descriptor.id },
      },
    });
    const thinking: string[] = [];

    const result = await runtime.run("请检查这道几何题的结构。", (event) => {
      if (event.type === "thinking_delta") thinking.push(event.delta);
    });

    expect(result.status).toBe("completed");
    expect(thinking.join("")).toBe("先识别已知条件，再检查可以直接使用的关系。");

    const reopened = await sessions.open("student-1", session.descriptor.id);
    const transcript = await reopened.getTranscript();
    expect(transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "thinking",
            thinking: "先识别已知条件，再检查可以直接使用的关系。",
          }),
          expect.objectContaining({
            type: "toolCall",
            id: "inspect-1",
            name: "inspect_problem_structure",
          }),
        ]),
      }),
      expect.objectContaining({
        role: "toolResult",
        toolCallId: "inspect-1",
        toolName: "inspect_problem_structure",
        isError: false,
        content: [{ type: "text", text: "已识别三条已知关系。" }],
      }),
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "现在先写出最直接的一组等量关系。" }],
      }),
    ]));
    const spans = telemetry.getSpans();
    const runSpan = spans.find((span) => span.name === "chalk.agent.run");
    expect(spans.find((span) => span.name === "chalk.agent.tool_call")).toEqual(
      expect.objectContaining({ parentId: runSpan?.id }),
    );
  });
});
