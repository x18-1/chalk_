import { type RuntimeTool, type SkillRegistry } from '@chalk/agent-runtime';
import { createReadSkillTool } from './tool';

export function createSkillTools(
  registry: SkillRegistry,
  enabledSkillNames: ReadonlySet<string>,
): RuntimeTool[] {
  return [createReadSkillTool(registry, enabledSkillNames)];
}
