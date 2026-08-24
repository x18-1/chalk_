import {
  closeUserRuntimes,
  listRuntimeTools,
  loadUserSkills,
} from '../../../agent/runtime-manager';
import type { Database } from '../../../db/client';
import { createSkillSettingsDal, createToolSettingsDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import type { SkillSettingInput, ToolSettingInput } from '../schemas';

export class RuntimeConfigurationService {
  private readonly skillSettings;
  private readonly toolSettings;

  constructor(db: Database) {
    this.skillSettings = createSkillSettingsDal(db);
    this.toolSettings = createToolSettingsDal(db);
  }

  async listSkills(userId: string) {
    const [{ snapshot }, settings] = await Promise.all([
      loadUserSkills(userId),
      this.skillSettings.list(userId),
    ]);
    const overrides = new Map(
      settings.map((setting) => [setting.skillName, setting.enabled]),
    );
    return {
      skills: snapshot.skills.map((skill) => ({
        ...skill,
        enabled: overrides.get(skill.name) ?? true,
      })),
      diagnostics: snapshot.diagnostics,
    };
  }

  async setSkill(userId: string, input: SkillSettingInput) {
    const { snapshot } = await loadUserSkills(userId);
    if (!snapshot.skills.some((skill) => skill.name === input.skillName)) {
      throw new ApiError(404, 'Skill not found', 'SKILL_NOT_FOUND');
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
