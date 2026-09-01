import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SkillRegistry,
  SkillRegistryError,
} from "../../src/skills/skill-registry";
import { ToolExecutionError } from "../../src/tools/tool-registry";
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
  it("loads builtin and user skills while keeping prompt injection metadata-only", async () => {
    const trustedPath = await createSkillDirectory("trusted-skill", "trusted fixture");
    const untrustedPath = await createSkillDirectory("untrusted-skill", "untrusted fixture");
    const registry = new SkillRegistry(trustedPath, [
      { id: "trusted", label: "trusted", path: trustedPath, trusted: true, scope: "builtin" },
      { id: "untrusted", label: "untrusted", path: untrustedPath, trusted: false, scope: "user" },
    ]);

    const snapshot = await registry.reload();
    expect(snapshot.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "trusted-skill",
        source: expect.objectContaining({ id: "trusted", trusted: true }),
      }),
      expect.objectContaining({
        name: "untrusted-skill",
        source: expect.objectContaining({ id: "untrusted", trusted: false, scope: "user" }),
      }),
    ]));
    expect(registry.systemPrompt(new Set())).not.toContain("trusted fixture");
    expect(registry.systemPrompt(new Set(["trusted-skill"]))).toContain("trusted fixture");
    expect(registry.systemPrompt(new Set(["trusted-skill"]))).not.toContain("Use trusted-skill only");
    expect(registry.systemPrompt(new Set(["trusted-skill"]))).not.toContain("read_skill({ name })");
    expect(registry.systemPrompt(new Set(["trusted-skill"]))).not.toContain("Do not construct absolute paths");
    expect(registry.systemPrompt(new Set(["trusted-skill"]))).not.toContain("SKILL.md");
    expect(registry.systemPrompt(new Set(["untrusted-skill"]))).not.toContain("/virtual-skills/");
    expect(registry.inspect("trusted-skill").content).toContain("trusted-skill");
    expect(registry.read("untrusted-skill", new Set(["untrusted-skill"])))
      .toContain("[BEGIN UNTRUSTED SKILL DATA]");
  });

  it("discovers user skills and reads references through the skill boundary", async () => {
    const root = await createSkillDirectory("user-skill", "user fixture");
    await mkdir(join(root, "user-skill", "references"), { recursive: true });
    await writeFile(join(root, "user-skill", "references", "guide.md"), "Reference-only guidance");
    const registry = new SkillRegistry(root, [
      { id: "user", label: "user", path: root, trusted: false, scope: "user" },
    ]);

    const snapshot = await registry.reload();
    expect(snapshot.skills).toEqual([
      expect.objectContaining({
        name: "user-skill",
        source: expect.objectContaining({ id: "user", scope: "user", trusted: false }),
      }),
    ]);
    const enabled = new Set(["user-skill"]);
    expect(await registry.readReference("user-skill", "references/guide.md", enabled))
      .toContain("Reference-only guidance");
    await expect(registry.readReference("user-skill", "../SKILL.md", enabled))
      .rejects.toMatchObject({ code: "skill_reference_invalid" });
    await expect(registry.readReference("user-skill", "references/../SKILL.md", enabled))
      .rejects.toMatchObject({ code: "skill_reference_invalid" });
    await expect(registry.readReference("user-skill", "references/missing.md", enabled))
      .rejects.toMatchObject({ code: "skill_reference_not_found" });
    await expect(registry.readReference("user-skill", "references/guide.md", new Set()))
      .rejects.toMatchObject({ code: "skill_disabled" });
  });

  it("rejects references that escape through a symbolic link", async () => {
    const root = await createSkillDirectory("linked-skill", "linked fixture");
    const skillRoot = join(root, "linked-skill");
    const referencesRoot = join(skillRoot, "references");
    await mkdir(referencesRoot, { recursive: true });
    await writeFile(join(skillRoot, "private.md"), "not a Skill reference");
    await symlink(join(skillRoot, "private.md"), join(referencesRoot, "linked.md"));
    const registry = new SkillRegistry(root, [
      { id: "trusted", label: "trusted", path: root, trusted: true },
    ]);
    await registry.reload();

    await expect(registry.readReference(
      "linked-skill",
      "references/linked.md",
      new Set(["linked-skill"]),
    )).rejects.toMatchObject({ code: "skill_reference_invalid" });
  });

  it("rejects builtin and user skills with the same name", async () => {
    const builtin = await createSkillDirectory("same-skill", "builtin fixture");
    const user = await createSkillDirectory("same-skill", "user fixture");
    const registry = new SkillRegistry(builtin, [
      { id: "builtin", label: "builtin", path: builtin, trusted: true, scope: "builtin" },
      { id: "user", label: "user", path: user, trusted: false, scope: "user" },
    ]);

    await expect(registry.reload()).rejects.toThrow("Duplicate skill name same-skill");
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

    const execution = tool.execute(
      { name: "disabled-skill" },
      { ownerId: "student-1", sessionId: "session-1" },
    );
    await expect(execution).rejects.toBeInstanceOf(ToolExecutionError);
    await expect(execution).rejects.toMatchObject({ code: "skill_disabled" });
  });

  it("rejects duplicate names across trusted sources", async () => {
    const first = await createSkillDirectory("duplicate-skill", "first fixture");
    const second = await createSkillDirectory("duplicate-skill", "second fixture");
    const registry = new SkillRegistry(first, [
      { id: "first", label: "first", path: first, trusted: true },
      { id: "second", label: "second", path: second, trusted: true },
    ]);

    const reload = registry.reload();
    await expect(reload).rejects.toBeInstanceOf(SkillRegistryError);
    await expect(reload).rejects.toMatchObject({ code: "skill_name_conflict" });
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

    expect(registry.systemPrompt(new Set(["hidden-skill"]))).toBe("");

    await expect(tool.execute(
      { name: "hidden-skill" },
      { ownerId: "student-1", sessionId: "session-1" },
    )).rejects.toThrow("does not allow model invocation");
  });
});
