import { selectModel } from '../../agent/runtime-manager';
import type { MemoryConsolidationModel } from '../../modules/memory/services/memory-consolidation.service';
import { buildPrompt, PROMPT_IDS } from '../../prompts';

export const piMemoryConsolidationModel: MemoryConsolidationModel = async ({ userId, events, entries }) => {
  const { catalog, model } = await selectModel(userId);
  const prompt = buildPrompt(PROMPT_IDS.MEMORY_CONSOLIDATION, {});
  const response = await catalog.completeSimple(model, {
    systemPrompt: prompt.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ events, entries }) }], timestamp: Date.now() }],
  }, { maxTokens: 1_200, maxRetries: 1, timeoutMs: 30_000 });
  return response.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
};
