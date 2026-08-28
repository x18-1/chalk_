import { ApiError } from '../../http/errors';
import type { ClassroomDiscussionModel } from '../../modules/classroom-discussions/services/classroom-discussion.graph';
import { createDiscussionOutputParser } from '../../modules/classroom-discussions/services/classroom-discussion-output';
import { selectModel } from '../../agent/runtime-manager';

type SelectDiscussionModel = typeof selectModel;

export function createPiClassroomDiscussionModel(
  selectDiscussionModel: SelectDiscussionModel = selectModel,
): ClassroomDiscussionModel {
  return {
    async complete(userId, input) {
      const { catalog, model } = await selectDiscussionModel(userId);
      const selected = await catalog.resolveModel(model);
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
          maxTokens: Math.min(selected.maxTokens, 128),
          maxRetries: 1,
          timeoutMs: 30_000,
          signal: input.signal,
          ...(model.thinkingLevel === 'off' ? {} : { reasoning: model.thinkingLevel }),
        },
      );
      if (response.stopReason === 'error' || response.stopReason === 'aborted') {
        throw new ApiError(502, 'The classroom discussion Director failed', 'CLASSROOM_DISCUSSION_DIRECTOR_FAILED');
      }
      const text = response.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim();
      if (!text) {
        throw new ApiError(502, 'The classroom discussion Director returned no decision', 'CLASSROOM_DISCUSSION_DIRECTOR_INVALID');
      }
      return { text, providerId: model.providerId, modelId: model.modelId };
    },

    async *stream(userId, input) {
      const { catalog, model } = await selectDiscussionModel(userId);
      const selected = await catalog.resolveModel(model);
      const stream = await catalog.streamSimple(
        model,
        {
          systemPrompt: input.system,
          messages: input.messages.map((message) => ({
            role: 'user' as const,
            content: [{ type: 'text' as const, text: message.sender === 'agent'
              ? `[Agent ${message.agentName ?? message.agentId ?? 'Classroom Agent'}]: ${message.content}`
              : `[Student (Human)]: ${message.content}` }],
            timestamp: Date.now(),
          })),
        },
        {
          maxTokens: Math.min(selected.maxTokens, 1_600),
          maxRetries: 1,
          timeoutMs: 60_000,
          signal: input.signal,
          ...(model.thinkingLevel === 'off' ? {} : { reasoning: model.thinkingLevel }),
        },
      );
      const parser = createDiscussionOutputParser();
      for await (const event of stream) {
        if (event.type === 'text_delta') {
          for (const output of parser.push(event.delta)) yield output;
        } else if (event.type === 'error') {
          throw new ApiError(502, 'The classroom discussion participant failed', 'CLASSROOM_DISCUSSION_PARTICIPANT_FAILED');
        }
      }
      for (const output of parser.finish()) yield output;
      yield {
        type: 'done' as const,
        providerId: model.providerId,
        modelId: model.modelId,
      };
    },
  };
}

export const piClassroomDiscussionModel = createPiClassroomDiscussionModel();
