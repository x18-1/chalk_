import { Type, type Static } from 'typebox';

import { ToolExecutionError, type RuntimeTool } from '../tools/tool-registry';
import { SkillRegistry, SkillRegistryError } from './skill-registry';

const readSkillParameters = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 64 }),
  reference: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
});

type ReadSkillArguments = Static<typeof readSkillParameters>;

export function createReadSkillTool(
  registry: SkillRegistry,
  enabledSkillNames: ReadonlySet<string>,
): RuntimeTool<typeof readSkillParameters> {
  return {
    name: 'read_skill',
    label: '读取 Skill',
    description: 'Use read_skill to read the full instructions for an enabled skill, or one of its references/<file> documents when needed. Do not use it to access files outside the skill.',
    parameters: readSkillParameters,
    source: 'chalk',
    effects: ['read'],
    approvalPolicy: 'none',
    defaultEnabled: true,
    requiresApproval: false,
    limits: { maxResultCharacters: 32_000 },
    executionMode: 'sequential',
    async execute(args: ReadSkillArguments) {
      let content: string;
      try {
        content = args.reference
          ? await registry.readReference(args.name, args.reference, enabledSkillNames)
          : registry.read(args.name, enabledSkillNames);
      } catch (error) {
        if (error instanceof SkillRegistryError) {
          throw new ToolExecutionError(error.code, error.message, error);
        }
        throw error;
      }
      return {
        content: [{ type: 'text', text: content }],
        details: {
          skillName: args.name,
          ...(args.reference ? { reference: args.reference } : {}),
        },
      };
    },
  };
}
