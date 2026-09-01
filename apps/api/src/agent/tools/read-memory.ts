import { Type, type Static } from 'typebox';
import type { RuntimeTool } from '@chalk/agent-runtime';
import type { MemoryService } from '../../modules/memory/services/memory.service';

export const READ_MEMORY_PROMPT =
  'Use read_memory when the learner\'s persistent preferences, goals, or recent learning context can improve the teaching response. ' +
  'It returns curated memory only; do not use it for factual knowledge or to infer mastery. ' +
  'Do not call it on every turn when the current question is self-contained.';

const parameters = Type.Object({}, { additionalProperties: false });
type Arguments = Static<typeof parameters>;

export function createReadMemoryTool(memory: MemoryService): RuntimeTool<typeof parameters> {
  return {
    name: 'read_memory', label: '读取学习记忆', description: READ_MEMORY_PROMPT,
    parameters, source: 'chalk', effects: ['read'], approvalPolicy: 'none', defaultEnabled: true,
    executionMode: 'sequential', limits: { maxResultCharacters: 8_000 },
    async execute(_args: Arguments, context) {
      const result = await memory.read(context.ownerId);
      return {
        content: [{ type: 'text', text: result.text }],
        details: { entryCount: result.entries.length },
      };
    },
  };
}
