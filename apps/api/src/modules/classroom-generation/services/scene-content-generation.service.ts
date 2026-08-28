import { randomUUID } from 'node:crypto';

import { ApiError } from '../../../http/errors';
import { PROMPT_IDS, buildPrompt } from '../../../prompts';
import {
  classroomOutlineSchema,
  quizGenerationResultSchema,
  slideGenerationResultSchema,
  type ClassroomOutline,
} from '../schemas';
import {
  generateWithAbort,
  type ClassroomGenerationDal,
  type ClassroomGenerationModel,
  type GenerationClaimContext,
} from './classroom-generation.types';
import { LeaseLostError } from './classroom-generation.worker-errors';
import { parseGeneratedJson } from './generated-json';
import { InteractiveDocumentError, parseInteractiveDocument } from './interactive-document';
import { normalizeInteractiveOutlines } from './interactive-outline';

export class SceneContentGenerationService {
  constructor(
    private readonly generation: ClassroomGenerationDal,
    private readonly model: ClassroomGenerationModel,
  ) {}

  async createRun(userId: string, outlineRunId: string) {
    const source = await this.generation.get(userId, outlineRunId);
    if (source.run.stage !== 'outline' || source.run.status !== 'completed' || !source.draft.outline) {
      throw new ApiError(409, 'Scene content requires a completed classroom outline', 'CLASSROOM_SCENE_CONTENT_NOT_READY');
    }
    const outline = normalizeInteractiveOutlines(classroomOutlineSchema.parse(source.draft.outline));
    const runId = randomUUID();
    const created = await this.generation.createSceneContentRun(userId, {
      runId,
      outlineRunId,
      draftId: source.draft.id,
      scenes: outline.outlines.map((scene) => ({
        outlineId: scene.id,
        type: scene.type,
        order: scene.order,
        outline: scene,
      })),
    });
    if (!created) {
      throw new ApiError(409, 'Scene content generation already exists for this draft', 'CLASSROOM_SCENE_CONTENT_EXISTS');
    }
    return runId;
  }

  async processClaim(context: GenerationClaimContext) {
    const course = normalizeInteractiveOutlines(classroomOutlineSchema.parse(context.draft.outline));
    const scenes = await this.generation.listScenes(context.userId, context.draft.id);
    for (const scene of scenes) {
      if (scene.status === 'completed') continue;
      await this.processScene(context, course, scene);
    }
    return this.generation.completeSceneContentRun(context.userId, {
      runId: context.runId,
      draftId: context.draft.id,
      workerId: context.workerId,
    });
  }

  async processScene(
    context: GenerationClaimContext,
    course: ClassroomOutline,
    scene: Awaited<ReturnType<ClassroomGenerationDal['listScenes']>>[number],
  ) {
    context.signal.throwIfAborted();
    const outline = course.outlines.find((candidate) => candidate.id === scene.outlineId);
    if (!outline) throw new SceneContentError('CLASSROOM_SCENE_OUTLINE_MISSING');
    const prompt = scenePrompt(outline, course.languageDirective);
    if (!prompt) {
      await this.generation.startScene(context.userId, {
        runId: context.runId,
        draftId: context.draft.id,
        sceneId: scene.id,
        workerId: context.workerId,
        promptId: null,
        promptRevision: null,
      });
      await this.generation.failScene(context.userId, {
        runId: context.runId,
        draftId: context.draft.id,
        sceneId: scene.id,
        workerId: context.workerId,
        errorCode: 'CLASSROOM_SCENE_CONTENT_UNSUPPORTED',
      });
      throw new SceneContentError('CLASSROOM_SCENE_CONTENT_UNSUPPORTED');
    }
    const started = await this.generation.startScene(context.userId, {
      runId: context.runId,
      draftId: context.draft.id,
      sceneId: scene.id,
      workerId: context.workerId,
      promptId: prompt.id,
      promptRevision: prompt.revision,
    });
    if (!started) throw new LeaseLostError();
    try {
      const generated = await generateWithAbort(this.model, context.userId, {
        system: prompt.system,
        user: prompt.user,
        signal: context.signal,
        maxRetries: 0,
        timeoutMs: 300_000,
      });
      context.signal.throwIfAborted();
      if (generated.stopReason === 'length') {
        throw new SceneContentError(truncatedContentErrorCode(outline.type));
      }
      const content = parseSceneContent(outline, generated.text);
      const saved = await this.generation.completeScene(context.userId, {
        runId: context.runId,
        draftId: context.draft.id,
        sceneId: scene.id,
        workerId: context.workerId,
        content,
        modelProviderId: generated.providerId,
        modelId: generated.modelId,
      });
      if (!saved) throw new LeaseLostError();
      return saved;
    } catch (error) {
      if (context.signal.aborted || error instanceof LeaseLostError) throw error;
      const code = error instanceof SceneContentError
        ? error.code
        : 'CLASSROOM_SCENE_CONTENT_GENERATION_FAILED';
      await this.generation.failScene(context.userId, {
        runId: context.runId,
        draftId: context.draft.id,
        sceneId: scene.id,
        workerId: context.workerId,
        errorCode: code,
      });
      throw new SceneContentError(code);
    }
  }
}

export class SceneContentError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function truncatedContentErrorCode(type: ClassroomOutline['outlines'][number]['type']) {
  if (type === 'slide') return 'CLASSROOM_SLIDE_CONTENT_TRUNCATED';
  if (type === 'quiz') return 'CLASSROOM_QUIZ_CONTENT_TRUNCATED';
  if (type === 'interactive') return 'CLASSROOM_INTERACTIVE_CONTENT_TRUNCATED';
  return 'CLASSROOM_SCENE_CONTENT_TRUNCATED';
}

function scenePrompt(outline: ClassroomOutline['outlines'][number], languageDirective: string) {
  const keyPoints = outline.keyPoints.map((point, index) => `${index + 1}. ${point}`).join('\n');
  if (outline.type === 'slide') {
    const media = outline.mediaGenerations ?? [];
    const imageEnabled = media.some((request) => request.type === 'image');
    const videoEnabled = media.some((request) => request.type === 'video');
    const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_SLIDE_CONTENT, {
      title: outline.title,
      description: outline.description,
      keyPoints,
      teacherContext: '',
      assignedImages: media.length > 0 ? formatAssignedMedia(media) : 'No media assigned',
      canvas_width: 1000,
      canvas_height: 562.5,
      languageDirective,
      mediaElementEnabled: media.length > 0,
      imageElementEnabled: imageEnabled,
      generatedImageEnabled: imageEnabled,
      generatedVideoEnabled: videoEnabled,
    });
    return { id: PROMPT_IDS.CLASSROOM_SLIDE_CONTENT, ...prompt, user: prompt.user! };
  }
  if (outline.type === 'quiz') {
    const config = outline.quizConfig ?? {
      questionCount: 3,
      difficulty: 'medium' as const,
      questionTypes: ['single'] as const,
    };
    const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_QUIZ_CONTENT, {
      title: outline.title,
      description: outline.description,
      keyPoints,
      questionCount: config.questionCount,
      difficulty: config.difficulty,
      questionTypes: config.questionTypes
        .map((type) => type === 'text' ? 'short_answer' : type)
        .join(', '),
      languageDirective,
    });
    return { id: PROMPT_IDS.CLASSROOM_QUIZ_CONTENT, ...prompt, user: prompt.user! };
  }
  if (outline.type === 'interactive') {
    const widget = outline.widgetOutline ?? {};
    const legacy = outline.interactiveConfig ?? {};
    if (outline.widgetType === 'simulation') {
      const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_SIMULATION_CONTENT, {
        conceptName: textValue(widget.concept) ?? textValue(legacy.conceptName) ?? outline.title,
        conceptOverview: outline.description,
        keyPoints,
        variables: stringList(widget.keyVariables).join(', '),
        designIdea: textValue(legacy.designIdea) ?? '',
        languageDirective,
      });
      return { id: PROMPT_IDS.CLASSROOM_SIMULATION_CONTENT, ...prompt, user: prompt.user! };
    }
    if (outline.widgetType === 'diagram') {
      const prescribedNodes = recordList(widget.nodes);
      const nodeCount = numberValue(widget.nodeCount) ?? prescribedNodes.length;
      const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_DIAGRAM_CONTENT, {
        title: outline.title,
        diagramType: textValue(widget.diagramType) ?? 'flowchart',
        description: outline.description,
        keyPoints,
        nodeCount,
        prescribedNodes,
        hasNodeCount: nodeCount > 0,
        hasPrescribedNodes: prescribedNodes.length > 0,
        languageDirective,
      });
      return { id: PROMPT_IDS.CLASSROOM_DIAGRAM_CONTENT, ...prompt, user: prompt.user! };
    }
    if (outline.widgetType === 'code') {
      const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_CODE_CONTENT, {
        title: outline.title,
        programmingLanguage: textValue(widget.language) ?? 'python',
        description: outline.description,
        keyPoints,
        starterCode: '',
        testCases: '',
        hints: '',
        languageDirective,
      });
      return { id: PROMPT_IDS.CLASSROOM_CODE_CONTENT, ...prompt, user: prompt.user! };
    }
    if (outline.widgetType === 'game') {
      const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_GAME_CONTENT, {
        title: outline.title,
        gameType: textValue(widget.gameType) ?? 'puzzle',
        description: outline.description,
        keyPoints,
        scoring: { correctPoints: 10, speedBonus: 5 },
        languageDirective,
      });
      return { id: PROMPT_IDS.CLASSROOM_GAME_CONTENT, ...prompt, user: prompt.user! };
    }
    if (outline.widgetType === 'visualization3d') {
      const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_VISUALIZATION3D_CONTENT, {
        title: outline.title,
        visualizationType: textValue(widget.visualizationType) ?? 'custom',
        description: outline.description,
        keyPoints,
        objects: unknownList(widget.objects),
        interactions: unknownList(widget.interactions),
        languageDirective,
      });
      return { id: PROMPT_IDS.CLASSROOM_VISUALIZATION3D_CONTENT, ...prompt, user: prompt.user! };
    }
  }
  return null;
}

function formatAssignedMedia(media: NonNullable<ClassroomOutline['outlines'][number]['mediaGenerations']>) {
  return media.map((request) => [
    `- ${request.elementId} (${request.type})`,
    `  aspect ratio: ${request.aspectRatio ?? '16:9'}`,
    `  purpose: ${request.prompt}`,
  ].join('\n')).join('\n');
}

function parseSceneContent(outline: ClassroomOutline['outlines'][number], text: string) {
  const type = outline.type;
  if (type === 'slide') {
    let parsed: unknown;
    try {
      parsed = parseGeneratedJson(text, 'object');
    } catch {
      throw new SceneContentError('CLASSROOM_SLIDE_CONTENT_INVALID');
    }
    const result = slideGenerationResultSchema.safeParse(parsed);
    if (!result.success) throw new SceneContentError('CLASSROOM_SLIDE_CONTENT_INVALID');
    return {
      type: 'slide' as const,
      canvas: {
        ...(result.data.background !== undefined ? { background: result.data.background } : {}),
        elements: result.data.elements,
      },
      ...(result.data.remark ? { remark: result.data.remark } : {}),
    };
  }
  if (type === 'quiz') {
    let parsed: unknown;
    try {
      parsed = parseGeneratedJson(text, 'array');
    } catch {
      throw new SceneContentError('CLASSROOM_QUIZ_CONTENT_INVALID');
    }
    const result = quizGenerationResultSchema.safeParse(parsed);
    if (!result.success) throw new SceneContentError('CLASSROOM_QUIZ_CONTENT_INVALID');
    return {
      type: 'quiz' as const,
      questions: result.data.map((question, index) => normalizeQuizQuestion(question, index)),
    };
  }
  if (type === 'interactive') {
    try {
      if (!outline.widgetType) throw new Error('Interactive widget type is missing');
      return parseInteractiveDocument(text, outline.widgetType);
    } catch (error) {
      if (error instanceof InteractiveDocumentError) throw new SceneContentError(error.code);
      throw new SceneContentError('CLASSROOM_INTERACTIVE_CONTENT_INVALID');
    }
  }
  throw new SceneContentError('CLASSROOM_SCENE_CONTENT_UNSUPPORTED');
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function unknownList(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function recordList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : [];
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeQuizQuestion(
  question: (typeof quizGenerationResultSchema)['_output'][number],
  index: number,
) {
  const isText = question.type === 'short_answer' || question.type === 'text';
  const rawAnswer = question.answer ?? question.correctAnswer ?? question.correct_answer;
  return {
    ...question,
    id: question.id ?? `question_${index + 1}`,
    type: isText ? 'short_answer' as const : question.type,
    ...(isText ? { options: undefined, answer: undefined, hasAnswer: false } : {
      options: normalizeQuizOptions(question.options),
      answer: rawAnswer === undefined ? undefined : Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer],
      hasAnswer: true,
    }),
    analysis: question.analysis ?? question.explanation,
  };
}

function normalizeQuizOptions(options: unknown[] | undefined) {
  return options?.map((option, index) => {
    const fallback = String.fromCharCode(65 + index);
    if (typeof option === 'string') return { value: fallback, label: option };
    if (option && typeof option === 'object') {
      const value = option as Record<string, unknown>;
      return {
        value: typeof value.value === 'string'
          ? value.value
          : typeof value.id === 'string' ? value.id : fallback,
        label: typeof value.label === 'string'
          ? value.label
          : typeof value.text === 'string' ? value.text : String(value.value ?? value.id ?? fallback),
      };
    }
    return { value: fallback, label: String(option) };
  });
}
