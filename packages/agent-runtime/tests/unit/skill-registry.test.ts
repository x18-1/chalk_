import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SkillRegistry } from "../../src/skills/skill-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createSkillDirectory(name: string, description: string) {
  const root = await mkdtemp(join("/tmp", "chalk-skill-test-"));
  temporaryDirectories.push(root);
  const skillDirectory = join(root, name);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nUse ${name} only for this deterministic test.\n`);
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
    expect(registry.invoke("trusted-skill")).toContain("trusted-skill");
    expect(() => registry.invoke("untrusted-skill")).toThrow("Skill untrusted-skill is not loaded");
  });
});
