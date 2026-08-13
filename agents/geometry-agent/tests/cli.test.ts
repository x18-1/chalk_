import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("geometry agent CLI", () => {
  it("fails closed and records a bounded failure when credentials are missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "geometry-agent-cli-"));
    directories.push(root);

    await expect(runCli(["--problem", "测试题", "--output", root], {})).rejects.toThrow(
      "GEOMETRY_AGENT_API_KEY is required",
    );

    const [runId] = await readdir(root);
    const failure = JSON.parse(await readFile(join(root, runId!, "failure.json"), "utf8"));
    expect(failure).toEqual({ message: "GEOMETRY_AGENT_API_KEY is required" });
  });
});
