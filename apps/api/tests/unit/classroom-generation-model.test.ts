import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';

import { createModelCatalogFromModels } from '../../src/providers/llm/model-catalog';
import { createPiClassroomGenerationModel } from '../../src/providers/llm/classroom-outline-model';

describe('Pi classroom generation model adapter', () => {
  it('uses the selected model output window and preserves a length stop reason', async () => {
    const observeRequest = vi.fn();
    const faux = fauxProvider({
      models: [{ id: 'long-html-model', maxTokens: 384_000 }],
    });
    faux.setResponses([
      (_context, options) => {
        observeRequest(options);
        return fauxAssistantMessage('<!DOCTYPE html><html><body>', { stopReason: 'length' });
      },
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const catalog = createModelCatalogFromModels(models);
    const model = createPiClassroomGenerationModel(async () => ({
      catalog,
      model: {
        providerId: faux.provider.id,
        modelId: faux.getModel().id,
        thinkingLevel: 'off' as const,
      },
    }));

    const result = await model.generate('user-1', {
      system: 'Generate one complete HTML document.',
      user: 'Create an educational game.',
      maxRetries: 0,
      timeoutMs: 300_000,
    });

    expect(observeRequest).toHaveBeenCalledWith(expect.objectContaining({
      maxTokens: 384_000,
      maxRetries: 0,
      timeoutMs: 300_000,
    }));
    expect(result).toMatchObject({
      providerId: faux.provider.id,
      modelId: faux.getModel().id,
      stopReason: 'length',
    });
  });
});
