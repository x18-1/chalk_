import {
  formatSkillInvocation,
  formatSkillsForSystemPrompt,
  loadSourcedSkills,
  type Skill,
  type SkillDiagnostic,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

export type SkillSource = {
  id: string;
  label: string;
  path: string;
  trusted: boolean;
};

export type SkillSummary = {
  name: string;
  description: string;
  filePath: string;
  source: Omit<SkillSource, "path">;
  disableModelInvocation: boolean;
};

export type SkillRegistrySnapshot = {
  skills: SkillSummary[];
  diagnostics: Array<SkillDiagnostic & { sourceId: string }>;
};

type LoadedSkill = {
  skill: Skill;
  source: SkillSource;
};

export class SkillRegistry {
  private loaded: LoadedSkill[] = [];
  private diagnostics: Array<SkillDiagnostic & { sourceId: string }> = [];
  private readonly env: NodeExecutionEnv;

  constructor(
    cwd: string,
    private readonly sources: readonly SkillSource[],
  ) {
    this.env = new NodeExecutionEnv({ cwd });
  }

  async reload(): Promise<SkillRegistrySnapshot> {
    const trustedSources = this.sources.filter((source) => source.trusted);
    const result = await loadSourcedSkills(
      this.env,
      trustedSources.map((source) => ({ path: source.path, source })),
    );

    this.loaded = result.skills;
    this.diagnostics = result.diagnostics.map((diagnostic) => ({
      type: diagnostic.type,
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.path,
      sourceId: diagnostic.source.id,
    }));
    return this.snapshot();
  }

  snapshot(): SkillRegistrySnapshot {
    return {
      skills: this.loaded.map(({ skill, source }) => ({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        source: {
          id: source.id,
          label: source.label,
          trusted: source.trusted,
        },
        disableModelInvocation: skill.disableModelInvocation === true,
      })),
      diagnostics: this.diagnostics.slice(),
    };
  }

  systemPrompt(enabledSkillNames?: ReadonlySet<string>) {
    const skills = this.loaded
      .map(({ skill }) => skill)
      .filter(
        (skill) =>
          !enabledSkillNames || enabledSkillNames.has(skill.name),
      );
    return formatSkillsForSystemPrompt(skills);
  }

  invoke(name: string, additionalInstructions?: string) {
    const loaded = this.loaded.find(({ skill }) => skill.name === name);
    if (!loaded) throw new Error(`Skill ${name} is not loaded`);
    return formatSkillInvocation(loaded.skill, additionalInstructions);
  }
}
