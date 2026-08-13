import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRunArtifactStore } from "../src/artifact-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("run artifact store", () => {
  it("writes an auditable run without persisting image bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "geometry-agent-artifacts-"));
    directories.push(root);
    const store = await createRunArtifactStore(root, "test-run");

    await store.writeInput({
      problem: "识别图形",
      images: [{ path: "/tmp/problem.png", mimeType: "image/png", byteLength: 512 }],
    });
    await store.appendEvent({
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "image", mimeType: "image/png", data: "base64-secret-image" }],
      },
    });

    expect(JSON.parse(await readFile(join(store.runDirectory, "input.json"), "utf8"))).toMatchObject({
      problem: "识别图形",
      images: [{ path: "/tmp/problem.png", byteLength: 512 }],
    });
    const session = await readFile(join(store.runDirectory, "session.jsonl"), "utf8");
    expect(session).not.toContain("base64-secret-image");
    expect(session).toContain("[image data omitted: 19 chars]");
  });
});
