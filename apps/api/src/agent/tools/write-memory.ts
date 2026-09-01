import { Type, type Static } from 'typebox';
import type { RuntimeTool } from '@chalk/agent-runtime';
import type { MemoryService } from '../../modules/memory/services/memory.service';

export const WRITE_MEMORY_PROMPT =
  'Use write_memory only when the learner explicitly states a durable preference, learning goal, or teaching requirement. ' +
  'Use op=add for a new durable preference or goal, and op=edit with targetId to correct an existing profile or preference. Never speculate about preferences or claim mastery. Explicit learner statements are persisted without an approval prompt.';

const parameters = Type.Object({
  op: Type.Optional(Type.Union([Type.Literal('add'), Type.Literal('edit')])),
  targetId: Type.Optional(Type.String({ format: 'uuid', description: 'Existing memory entry id when op is edit.' })),
  text: Type.String({ minLength: 1, maxLength: 240, description: 'Explicit preference, goal, or teaching requirement.' }),
  slot: Type.Optional(Type.Union([Type.Literal('preferences'), Type.Literal('profile')], { description: 'Use preferences for style/format and profile for durable goals or learner facts.' })),
  reason: Type.Optional(Type.String({ maxLength: 240, description: 'Short explanation of why this explicit statement should persist.' })),
}, { additionalProperties: false });
type Arguments = Static<typeof parameters>;

export function createWriteMemoryTool(memory: MemoryService): RuntimeTool<typeof parameters> {
  return {
    name: 'write_memory', label: '保存学习记忆', description: WRITE_MEMORY_PROMPT,
    parameters, source: 'chalk', effects: ['write'], approvalPolicy: 'conditional', defaultEnabled: true,
    requiresApproval: async () => false,
    executionMode: 'sequential', limits: { maxResultCharacters: 2_000 },
    async execute(args: Arguments, context) {
      const result = args.op === 'edit' && args.targetId
        ? { entry: await memory.editPreference(context.ownerId, args.targetId, args), event: { id: 'edited' }, deduplicated: false }
        : await memory.writePreference(context.ownerId, args);
      const verb = result.deduplicated ? '已存在，未重复保存' : '已保存';
      return {
        content: [{ type: 'text', text: `学习记忆${verb}。` }],
        details: { entryId: result.entry.id, eventId: result.event.id, deduplicated: result.deduplicated },
      };
    },
  };
}
