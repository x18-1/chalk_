import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SkillRegistry } from "../../src/skills/skill-registry";
import { createReadSkillTool } from "../../src/skills/read-skill-tool";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createSkillDirectory(name: string, description: string, frontmatter = "") {
  const root = await mkdtemp(join("/tmp", "chalk-skill-test-"));
  temporaryDirectories.push(root);
  const skillDirectory = join(root, name);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n${frontmatter}---\n\nUse ${name} only for this deterministic test.\n`);
  return root;
}

describe("SkillRegistry", () => {
  it("loads trusted skills, excludes untrusted sources, and scopes prompt injection", async () => {
    const trustedPath = await createSkillDirectory("trusted-skill", "trusted fixture");
    const untrustedPath = await createSkillDirectory("untrusted-skill", "untrusted fixture");
    const registry = new SkillRegistry(trustedPath, [
      { id: "trusted", label: "trusted", path: trustedPath, trusted: true },
      { id: "untrusted", label: "untrusted", path: untrustedPath, trusted: false },
    ]);

    const snapshot = await registry.reload();
    expect(snapshot.skills).toEqual([
      expect.objectContaining({
        name: "trusted-skill",
        source: expect.objectContaining({ id: "trusted", trusted: true }),
      }),
    ]);
    expect(registry.systemPrompt(new Set())).not.toContain("trusted fixture");
    expect(registry.systemPrompt(new Set(["trusted-skill"]))).toContain("trusted fixture");
    expect(registry.systemPrompt(new Set(["trusted-skill"]))).not.toContain("Use trusted-skill only");
    expect(registry.invoke("trusted-skill")).toContain("trusted-skill");
    expect(() => registry.invoke("untrusted-skill")).toThrow("Skill untrusted-skill is not loaded");
  });

  it("reads enabled skill content through the controlled tool", async () => {
    const root = await createSkillDirectory("lesson-skill", "lesson fixture");
    const registry = new SkillRegistry(root, [
      { id: "trusted", label: "trusted", path: root, trusted: true },
    ]);
    await registry.reload();
    const tool = createReadSkillTool(registry, new Set(["lesson-skill"]));

    const result = await tool.execute(
      { name: "lesson-skill" },
      { ownerId: "student-1", sessionId: "session-1" },
    );

    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(result)).toContain("Use lesson-skill only");
  });

  it("rejects disabled skills before exposing their content", async () => {
    const root = await createSkillDirectory("disabled-skill", "disabled fixture");
    const registry = new SkillRegistry(root, [
      { id: "trusted", label: "trusted", path: root, trusted: true },
    ]);
    await registry.reload();
    const tool = createReadSkillTool(registry, new Set());

    await expect(tool.execute(
      { name: "disabled-skill" },
      { ownerId: "student-1", sessionId: "session-1" },
    )).rejects.toThrow("Skill disabled-skill is disabled");
  });

  it("rejects duplicate names across trusted sources", async () => {
    const first = await createSkillDirectory("duplicate-skill", "first fixture");
    const second = await createSkillDirectory("duplicate-skill", "second fixture");
    const registry = new SkillRegistry(first, [
      { id: "first", label: "first", path: first, trusted: true },
      { id: "second", label: "second", path: second, trusted: true },
    ]);

    await expect(registry.reload()).rejects.toThrow(
      "Duplicate skill name duplicate-skill",
    );
  });

  it("does not allow model invocation for explicitly hidden skills", async () => {
    const root = await createSkillDirectory(
      "hidden-skill",
      "hidden fixture",
      "disable-model-invocation: true\n",
    );
    const registry = new SkillRegistry(root, [
      { id: "trusted", label: "trusted", path: root, trusted: true },
    ]);
    await registry.reload();
    const tool = createReadSkillTool(registry, new Set(["hidden-skill"]));

    await expect(tool.execute(
      { name: "hidden-skill" },
      { ownerId: "student-1", sessionId: "session-1" },
    )).rejects.toThrow("does not allow model invocation");
  });
});
