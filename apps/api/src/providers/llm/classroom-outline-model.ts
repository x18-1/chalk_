import type { ClassroomGenerationModel } from '../../modules/classroom-generation/services/classroom-generation.service';
import { ApiError } from '../../http/errors';
import { selectModel } from '../../agent/runtime-manager';

type SelectClassroomModel = typeof selectModel;

export function createPiClassroomGenerationModel(
  selectClassroomModel: SelectClassroomModel = selectModel,
): ClassroomGenerationModel {
  return {
    async *stream(userId, input) {
      const { catalog, model } = await selectClassroomModel(userId);
      const selectedModel = await catalog.resolveModel(model);
      const stream = await catalog.streamSimple(
        model,
        classroomRequestContext(input),
        classroomRequestOptions(model.thinkingLevel, selectedModel.maxTokens, input),
      );
      for await (const event of stream) {
        if (event.type === 'text_delta') {
          yield { type: 'text_delta', delta: event.delta };
        } else if (event.type === 'error') {
          throw new ApiError(502, 'The classroom outline model request failed', 'CLASSROOM_OUTLINE_MODEL_FAILED');
        } else if (event.type === 'done') {
          yield {
            type: 'done',
            providerId: model.providerId,
            modelId: model.modelId,
            stopReason: event.reason,
          };
        }
      }
    },
    async generate(userId, input) {
      const { catalog, model } = await selectClassroomModel(userId);
      const selectedModel = await catalog.resolveModel(model);
      const response = await catalog.completeSimple(
        model,
        classroomRequestContext(input),
        classroomRequestOptions(model.thinkingLevel, selectedModel.maxTokens, input),
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

function classroomRequestContext(input: { system: string; user: string }) {
  return {
    systemPrompt: input.system,
    messages: [{
      role: 'user' as const,
      content: [{ type: 'text' as const, text: input.user }],
      timestamp: Date.now(),
    }],
  };
}

function classroomRequestOptions(
  thinkingLevel: ModelThinkingLevel,
  maxTokens: number,
  input: { signal?: AbortSignal; maxRetries?: number; timeoutMs?: number },
) {
  return {
    maxTokens,
    maxRetries: input.maxRetries ?? 2,
    timeoutMs: input.timeoutMs ?? 120_000,
    signal: input.signal,
    ...(thinkingLevel === 'off' ? {} : { reasoning: thinkingLevel }),
  };
}

export const piClassroomOutlineModel = createPiClassroomGenerationModel();
import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
