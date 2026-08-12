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
import { ForegroundSubagentExecutor } from "../../src/subagent/subagent-executor";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ForegroundSubagentExecutor", () => {
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
          models,
          model: {
            providerId: faux.provider.id,
            modelId: faux.getModel().id,
          },
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
    await expect(sessions.open(result.childSessionId)).resolves.toBeDefined();
  });
});
