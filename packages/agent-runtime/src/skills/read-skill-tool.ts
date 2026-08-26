import { Type, type Static } from 'typebox';

import type { RuntimeTool } from '../tools/tool-registry';
import { SkillRegistry } from './skill-registry';

const readSkillParameters = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 64 }),
});

type ReadSkillArguments = Static<typeof readSkillParameters>;

export function createReadSkillTool(
  registry: SkillRegistry,
  enabledSkillNames: ReadonlySet<string>,
): RuntimeTool<typeof readSkillParameters> {
  return {
    name: 'read_skill',
    label: '读取 Skill',
    description: '读取一个已启用的 Skill 的完整指令。只能按 Skill 名称读取已注册内容。',
    parameters: readSkillParameters,
    source: 'chalk',
    effects: ['read'],
    approvalPolicy: 'none',
    defaultEnabled: true,
    requiresApproval: false,
    limits: { maxResultCharacters: 32_000 },
    executionMode: 'sequential',
    async execute(args: ReadSkillArguments) {
      const content = registry.read(args.name, enabledSkillNames);
      return {
        content: [{ type: 'text', text: content }],
        details: { skillName: args.name },
      };
    },
  };
}
