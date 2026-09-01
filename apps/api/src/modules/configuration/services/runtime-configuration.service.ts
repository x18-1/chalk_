import {
  closeUserRuntimes,
  listRuntimeTools,
  loadUserSkills,
} from '../../../agent/runtime-manager';
import type { Database } from '../../../db/client';
import { createSkillSettingsDal, createToolSettingsDal, createUserSkillsDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import type { SkillSettingInput, ToolSettingInput } from '../schemas';

export class RuntimeConfigurationService {
  private readonly skillSettings;
  private readonly toolSettings;
  private readonly db;

  constructor(db: Database) {
    this.db = db;
    this.skillSettings = createSkillSettingsDal(db);
    this.toolSettings = createToolSettingsDal(db);
  }

  async listSkills(userId: string) {
    const [{ snapshot, enabledSkillNames }, userSkills] = await Promise.all([
      loadUserSkills(userId),
      createUserSkillsDal(this.db).list(userId),
    ]);
    const userSkillsByName = new Map(userSkills.map((skill) => [skill.name, skill]));
    return {
      skills: snapshot.skills.map((skill) => ({
        ...skill,
        ...(userSkillsByName.get(skill.name)
          ? (() => {
              const userSkill = userSkillsByName.get(skill.name)!;
              return { userSkillId: userSkill.id, version: userSkill.version, contentHash: userSkill.contentHash, references: Object.keys((userSkill.references as Record<string, string> | null) ?? {}) };
            })()
          : {}),
        enabled: enabledSkillNames.has(skill.name),
      })),
      diagnostics: snapshot.diagnostics,
    };
  }

  async getSkill(userId: string, name: string) {
    const { registry, snapshot, enabledSkillNames } = await loadUserSkills(userId);
    const summary = snapshot.skills.find((skill) => skill.name === name);
    if (!summary) throw new ApiError(404, 'Skill not found', 'SKILL_NOT_FOUND');
    const details = registry.inspect(name);
    return {
      skill: {
        ...details,
        enabled: enabledSkillNames.has(name),
      },
    };
  }

  async setSkill(userId: string, input: SkillSettingInput) {
    const { snapshot } = await loadUserSkills(userId);
    const skill = snapshot.skills.find((candidate) => candidate.name === input.skillName);
    if (!skill) {
      throw new ApiError(404, 'Skill not found', 'SKILL_NOT_FOUND');
    }
    if (skill.source.scope === 'user') {
      const userSkills = createUserSkillsDal(this.db);
      const owned = (await userSkills.list(userId)).find((candidate) => candidate.name === input.skillName);
      if (!owned) throw new ApiError(404, 'Skill not found', 'SKILL_NOT_FOUND');
      const updated = await userSkills.update(userId, owned.id, { enabled: input.enabled });
      await closeUserRuntimes(userId);
      return {
        setting: {
          skillName: updated.name,
          enabled: updated.enabled,
          updatedAt: updated.updatedAt,
        },
      };
    }
    const setting = await this.skillSettings.setEnabled(
      userId,
      input.skillName,
      input.enabled,
    );
    await closeUserRuntimes(userId);
    return { setting };
  }

  async listTools(userId: string) {
    const [tools, settings] = await Promise.all([
      listRuntimeTools(userId),
      this.toolSettings.list(userId),
    ]);
    const overrides = new Map(
      settings.map((setting) => [setting.toolName, setting]),
    );
    return {
      tools: tools.map((tool) => ({
        ...tool,
        enabled: overrides.get(tool.name)?.enabled ?? tool.defaultEnabled,
        approval: overrides.get(tool.name)?.approval ?? 'default',
      })),
    };
  }

  async setTool(userId: string, input: ToolSettingInput) {
    const tools = await listRuntimeTools(userId);
    if (!tools.some((tool) => tool.name === input.toolName)) {
      throw new ApiError(404, 'Tool not found', 'TOOL_NOT_FOUND');
    }
    const tool = tools.find((candidate) => candidate.name === input.toolName)!;
    if (input.approval === 'never' && tool.requiresApproval) {
      throw new ApiError(
        400,
        'This tool requires approval and cannot disable it',
        'TOOL_APPROVAL_REQUIRED',
      );
    }
    const setting = await this.toolSettings.upsert(userId, input.toolName, input);
    await closeUserRuntimes(userId);
    return { setting };
  }
}
