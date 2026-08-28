import { ApiError } from '../../../http/errors';
import { PROMPT_IDS, buildPrompt } from '../../../prompts';
import {
  type ClassroomDraftContext,
} from '../schemas';
import {
  type ClassroomGenerationDal,
  type ClassroomGenerationModel,
  type GenerationClaimContext,
  streamWithAbort,
} from './classroom-generation.types';
import { OutlineStreamParser } from './outline-stream-parser';

const MAX_STREAM_ATTEMPTS = 3;

export class OutlineGenerationService {
  constructor(
    private readonly generation: ClassroomGenerationDal,
    private readonly model: ClassroomGenerationModel,
  ) {}

  getPromptMetadata(requirements: string, context: unknown) {
    const prompt = outlinePrompt(requirements, asDraftContext(context));
    return { id: PROMPT_IDS.CLASSROOM_OUTLINE, revision: prompt.revision };
  }

  async processClaim(context: GenerationClaimContext) {
    const prompt = outlinePrompt(
      context.draft.requirements,
      asDraftContext(context.draft.context),
    );
    const draftContext = asDraftContext(context.draft.context);
    const existingEvents = await this.generation.listOutlineEvents(context.userId, context.runId);
    let eventOrder = existingEvents.at(-1)?.eventOrder ?? 0;
    if (existingEvents.length > 0) {
      eventOrder = await this.appendEvent(context, eventOrder, {
        type: 'retry',
        attempt: 0,
        maxAttempts: MAX_STREAM_ATTEMPTS,
      });
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_STREAM_ATTEMPTS; attempt += 1) {
      try {
        const parser = new OutlineStreamParser(draftContext.media);
        let modelProviderId: string | null = null;
        let modelId: string | null = null;
        for await (const event of streamWithAbort(this.stream(context, prompt), context.signal)) {
          context.signal.throwIfAborted();
          if (event.type === 'done') {
            modelProviderId = event.providerId;
            modelId = event.modelId;
            continue;
          }
          for (const parsedEvent of parser.push(event.delta)) {
            eventOrder = await this.appendEvent(context, eventOrder, parsedEvent);
          }
        }
        if (!modelProviderId || !modelId) {
          throw new ApiError(502, 'The classroom outline model stream ended unexpectedly', 'CLASSROOM_OUTLINE_MODEL_FAILED');
        }
        const outline = parser.finish();
        const doneEvent = {
          type: 'done' as const,
          outlines: outline.outlines,
          languageDirective: outline.languageDirective,
          courseTitle: outline.courseTitle,
        };
        return this.generation.completeOutline(context.userId, {
          runId: context.runId,
          draftId: context.draft.id,
          workerId: context.workerId,
          outline,
          courseTitle: outline.courseTitle,
          eventOrder: eventOrder + 1,
          doneEvent,
          modelProviderId,
          modelId,
        });
      } catch (error) {
        context.signal.throwIfAborted();
        lastError = error;
        if (error instanceof ApiError && error.code === 'CLASSROOM_OUTLINE_TYPE_UNSUPPORTED') break;
        if (attempt < MAX_STREAM_ATTEMPTS) {
          eventOrder = await this.appendEvent(context, eventOrder, {
            type: 'retry',
            attempt,
            maxAttempts: MAX_STREAM_ATTEMPTS,
          });
        }
      }
    }
    await this.appendEvent(context, eventOrder, {
      type: 'error',
      error: 'Unable to generate a valid classroom outline',
    });
    throw lastError instanceof Error
      ? lastError
      : new ApiError(502, 'The model returned an invalid classroom outline', 'CLASSROOM_OUTLINE_INVALID');
  }

  private stream(context: GenerationClaimContext, prompt: ReturnType<typeof outlinePrompt>) {
    if (this.model.stream) {
      return this.model.stream(context.userId, {
        system: prompt.system,
        user: prompt.user!,
        signal: context.signal,
        maxRetries: 0,
        timeoutMs: 300_000,
      });
    }
    const model = this.model;
    return (async function* fallbackStream() {
      const generated = await model.generate(context.userId, {
        system: prompt.system,
        user: prompt.user!,
        signal: context.signal,
        maxRetries: 2,
        timeoutMs: 300_000,
      });
      yield { type: 'text_delta' as const, delta: generated.text };
      yield {
        type: 'done' as const,
        providerId: generated.providerId,
        modelId: generated.modelId,
        stopReason: generated.stopReason,
      };
    })();
  }

  private async appendEvent(
    context: GenerationClaimContext,
    currentOrder: number,
    event: { type: string } & Record<string, unknown>,
  ) {
    const eventOrder = currentOrder + 1;
    const appended = await this.generation.appendOutlineEvent(context.userId, {
      runId: context.runId,
      workerId: context.workerId,
      eventOrder,
      type: event.type,
      data: event,
    });
    if (!appended) context.signal.throwIfAborted();
    if (!appended) throw new Error('Classroom outline generation lease was lost');
    return eventOrder;
  }
}

function asDraftContext(value: unknown): ClassroomDraftContext {
  return value && typeof value === 'object' ? value as ClassroomDraftContext : {};
}

function outlinePrompt(requirements: string, context: ClassroomDraftContext) {
  const imageEnabled = Boolean(context.media?.image);
  const videoEnabled = Boolean(context.media?.video);
  return buildPrompt(PROMPT_IDS.CLASSROOM_OUTLINE, {
    requirement: requirements,
    pdfContent: context.sourceText || 'None',
    availableImages: 'No images available',
    researchContext: 'None',
    teacherContext: '',
    userProfile: '',
    hasSourceImages: false,
    imageEnabled,
    videoEnabled,
    mediaEnabled: imageEnabled || videoEnabled,
  });
}
