import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonlSessionRepository, SessionNotFoundError } from "../../src/session/session-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createRepository() {
  const directory = await mkdtemp(join(tmpdir(), "chalk-session-test-"));
  temporaryDirectories.push(directory);

  return createJsonlSessionRepository({
    sessionsRoot: join(directory, "sessions"),
    cwd: directory,
  });
}

describe("SessionRepository", () => {
  it("reopens a session with its complete conversation transcript", async () => {
    const repository = await createRepository();
    const created = await repository.create({ ownerId: "student-1" });

    const userMessage = {
      role: "user",
      content: [{ type: "text", text: "为什么要连接 AC？" }],
      timestamp: 1,
    } satisfies AgentMessage;
    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "先找两个三角形的公共边。" }],
      api: "faux",
      provider: "faux",
      model: "faux",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    } satisfies AgentMessage;

    await created.appendMessage(userMessage);
    await created.appendMessage(assistantMessage);

    const reopened = await repository.open("student-1", created.descriptor.id);

    expect(reopened.descriptor.path).toBe(created.descriptor.path);
    expect(reopened.descriptor.ownerId).toBe("student-1");
    expect(await reopened.getMessages()).toEqual([userMessage, assistantMessage]);
  });

  it("deletes only the requested session", async () => {
    const repository = await createRepository();
    const first = await repository.create({ ownerId: "student-1" });
    const second = await repository.create({ ownerId: "student-1" });

    await repository.delete("student-1", first.descriptor.id);

    await expect(repository.open("student-1", first.descriptor.id)).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(repository.open("student-1", second.descriptor.id)).resolves.toBeDefined();
  });

  it("hides a session from the wrong owner", async () => {
    const repository = await createRepository();
    const created = await repository.create({ ownerId: "student-1" });

    await expect(
      repository.open("student-2", created.descriptor.id),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(
      repository.delete("student-2", created.descriptor.id),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(
      repository.open("student-1", created.descriptor.id),
    ).resolves.toBeDefined();
  });

  it("fails closed for a legacy session without owner metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chalk-session-test-"));
    temporaryDirectories.push(directory);
    const sessionsRoot = join(directory, "sessions");
    const upstream = new JsonlSessionRepo({
      fs: new NodeExecutionEnv({ cwd: directory }),
      sessionsRoot,
    });
    const legacy = await upstream.create({ cwd: directory });
    const legacyMetadata = await legacy.getMetadata();
    const repository = createJsonlSessionRepository({ sessionsRoot, cwd: directory });

    await expect(
      repository.open("student-1", legacyMetadata.id),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(
      repository.delete("student-1", legacyMetadata.id),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});
