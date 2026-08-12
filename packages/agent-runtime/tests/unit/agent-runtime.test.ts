import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonlSessionRepository } from "../../src/session/session-repository";
import { createAgentRuntime } from "../../src/runtime/agent-runtime";

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
      model: { providerId: faux.provider.id, modelId: faux.getModel().id },
      systemPrompt: "你是 Chalk 数学老师。",
    });
    const deltas: string[] = [];

    const result = await runtime.run("为什么要连接 AC？", (event) => {
      if (event.type === "text_delta") deltas.push(event.delta);
    });

    expect(result.status).toBe("completed");
    expect(deltas.join("")).toBe("先观察公共边 AC。");

    const reopened = await sessions.open(session.descriptor.id);
    const messages = await reopened.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
  });

  it("fails closed when the selected model does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-runtime-test-"));
    temporaryDirectories.push(directory);
    const sessions = createJsonlSessionRepository({
      sessionsRoot: join(directory, "sessions"),
      cwd: directory,
    });
    const session = await sessions.create();

    await expect(
      createAgentRuntime({
        session,
        models: createModels(),
        model: { providerId: "missing", modelId: "missing" },
        systemPrompt: "test",
      }),
    ).rejects.toThrow("Model missing/missing is not available");
  });
});
