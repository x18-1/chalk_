import type { SkillSummary } from '@chalk/agent-runtime';

type SkillSetting = {
  skillName: string;
  enabled: boolean;
};

type UserSkillSetting = {
  name: string;
  enabled: boolean;
};

export function resolveEnabledSkillNames(
  skills: readonly SkillSummary[],
  builtinSettings: readonly SkillSetting[],
  userSkills: readonly UserSkillSetting[],
) {
  const builtinEnabled = new Map(
    builtinSettings.map((setting) => [setting.skillName, setting.enabled]),
  );
  const userEnabled = new Map(
    userSkills.map((skill) => [skill.name, skill.enabled]),
  );
  return new Set(
    skills
      .filter((skill) => skill.source.scope === 'user'
        ? userEnabled.get(skill.name) === true
        : (builtinEnabled.get(skill.name) ?? true))
      .map((skill) => skill.name),
  );
}
