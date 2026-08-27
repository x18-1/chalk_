import { ApiError } from '../../../http/errors';
import { PROMPT_IDS, buildPrompt } from '../../../prompts';
import {
  classroomOutlineSchema,
  type ClassroomDraftContext,
  type ClassroomMediaPlanningConfig,
} from '../schemas';
import {
  generateWithAbort,
  type ClassroomGenerationDal,
  type ClassroomGenerationModel,
  type GenerationClaimContext,
} from './classroom-generation.types';
import { parseGeneratedJson } from './generated-json';
import { normalizeInteractiveOutlines } from './interactive-outline';

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
    const generated = await generateWithAbort(this.model, context.userId, {
      system: prompt.system,
      user: prompt.user!,
      signal: context.signal,
      maxRetries: 2,
      timeoutMs: 300_000,
    });
    context.signal.throwIfAborted();
    const draftContext = asDraftContext(context.draft.context);
    const outline = parseOutline(generated.text, draftContext.media);
    return this.generation.completeOutline(context.userId, {
      runId: context.runId,
      draftId: context.draft.id,
      workerId: context.workerId,
      outline,
      modelProviderId: generated.providerId,
      modelId: generated.modelId,
    });
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

function parseOutline(text: string, media: ClassroomMediaPlanningConfig | undefined) {
  let parsed: unknown;
  try {
    parsed = parseGeneratedJson(text, 'object');
  } catch {
    throw new ApiError(502, 'The model returned an invalid classroom outline', 'CLASSROOM_OUTLINE_INVALID');
  }
  const result = classroomOutlineSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(502, 'The model returned an invalid classroom outline', 'CLASSROOM_OUTLINE_INVALID');
  }
  const requests = result.data.outlines.flatMap((outline) => outline.mediaGenerations ?? []);
  if (requests.some((request) => request.type === 'image' ? !media?.image : !media?.video)) {
    throw new ApiError(502, 'The model returned an invalid classroom outline', 'CLASSROOM_OUTLINE_INVALID');
  }
  return normalizeInteractiveOutlines(result.data);
}
