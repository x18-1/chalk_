import type { ClassroomGenerationModel } from '../../modules/classroom-generation/services/classroom-generation.service';
import { ApiError } from '../../http/errors';
import { selectModel } from '../../agent/runtime-manager';

type SelectClassroomModel = typeof selectModel;

export function createPiClassroomGenerationModel(
  selectClassroomModel: SelectClassroomModel = selectModel,
): ClassroomGenerationModel {
  return {
    async generate(userId, input) {
      const { catalog, model } = await selectClassroomModel(userId);
      const selectedModel = await catalog.resolveModel(model);
      const response = await catalog.completeSimple(
        model,
        {
          systemPrompt: input.system,
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: input.user }],
            timestamp: Date.now(),
          }],
        },
        {
          maxTokens: selectedModel.maxTokens,
          maxRetries: input.maxRetries ?? 2,
          timeoutMs: input.timeoutMs ?? 120_000,
          signal: input.signal,
          ...(model.thinkingLevel === 'off' ? {} : { reasoning: model.thinkingLevel }),
        },
      );
      if (response.stopReason === 'error' || response.stopReason === 'aborted') {
        throw new ApiError(502, 'The classroom outline model request failed', 'CLASSROOM_OUTLINE_MODEL_FAILED');
      }
      const text = response.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim();
      if (!text) throw new ApiError(502, 'The classroom outline model returned no content', 'CLASSROOM_OUTLINE_INVALID');
      return {
        providerId: model.providerId,
        modelId: model.modelId,
        text,
        stopReason: response.stopReason,
      };
    },
  };
}

export const piClassroomOutlineModel = createPiClassroomGenerationModel();
