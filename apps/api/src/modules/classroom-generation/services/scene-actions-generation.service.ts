import { randomUUID } from 'node:crypto';

import { ActionSchema, type Action } from '@chalk/chalkboard';

import { ApiError } from '../../../http/errors';
import { PROMPT_IDS, buildPrompt } from '../../../prompts';
import { classroomOutlineSchema, type ClassroomOutline } from '../schemas';
import {
  generateWithAbort,
  type ClassroomGenerationDal,
  type ClassroomGenerationModel,
  type GenerationClaimContext,
} from './classroom-generation.types';
import { LeaseLostError } from './classroom-generation.worker-errors';
import { parseGeneratedJson } from './generated-json';
import { hasInteractiveTarget, interactiveElementInventory } from './interactive-document';
import { normalizeInteractiveOutlines } from './interactive-outline';

const SLIDE_ACTIONS = new Set(['spotlight', 'laser', 'play_video', 'discussion']);
const INTERACTIVE_ACTIONS = new Set([
  'widget_highlight',
  'widget_setState',
  'widget_annotation',
  'widget_reveal',
]);

export class SceneActionsGenerationService {
  constructor(
    private readonly generation: ClassroomGenerationDal,
    private readonly model: ClassroomGenerationModel,
  ) {}

  async createRun(userId: string, contentRunId: string) {
    const source = await this.generation.get(userId, contentRunId);
    if (source.run.stage !== 'scene_content' || source.run.status !== 'completed') {
      throw new ApiError(409, 'Scene actions require completed scene content', 'CLASSROOM_SCENE_ACTIONS_NOT_READY');
    }
    const runId = randomUUID();
    const created = await this.generation.createSceneActionsRun(userId, {
      runId,
      contentRunId,
      draftId: source.draft.id,
    });
    if (!created) {
      throw new ApiError(409, 'Scene actions generation already exists for this draft', 'CLASSROOM_SCENE_ACTIONS_EXISTS');
    }
    return runId;
  }

  async processClaim(context: GenerationClaimContext) {
    const course = normalizeInteractiveOutlines(classroomOutlineSchema.parse(context.draft.outline));
    const scenes = await this.generation.listScenes(context.userId, context.draft.id);
    const previousSpeeches: string[] = [];

    for (const scene of scenes) {
      if (scene.actionStatus === 'completed') {
        previousSpeeches.push(...speechTexts(scene.actions));
        continue;
      }
      context.signal.throwIfAborted();
      const outline = course.outlines.find((candidate) => candidate.id === scene.outlineId);
      if (!outline) throw new SceneActionsError('CLASSROOM_SCENE_OUTLINE_MISSING');
      const prompt = sceneActionsPrompt({
        course,
        outline,
        content: scene.content,
        previousSpeeches,
      });
      if (!prompt) {
        throw new SceneActionsError('CLASSROOM_SCENE_ACTIONS_UNSUPPORTED');
      }
      const started = await this.generation.startSceneActions(context.userId, {
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
          timeoutMs: 60_000,
        });
        context.signal.throwIfAborted();
        const actions = parseSceneActions(outline, scene.content, generated.text);
        const saved = await this.generation.completeSceneActions(context.userId, {
          runId: context.runId,
          draftId: context.draft.id,
          sceneId: scene.id,
          workerId: context.workerId,
          actions,
          modelProviderId: generated.providerId,
          modelId: generated.modelId,
        });
        if (!saved) throw new LeaseLostError();
        previousSpeeches.push(...speechTexts(actions));
      } catch (error) {
        if (context.signal.aborted || error instanceof LeaseLostError) throw error;
        const code = error instanceof SceneActionsError
          ? error.code
          : 'CLASSROOM_SCENE_ACTIONS_GENERATION_FAILED';
        await this.generation.failSceneActions(context.userId, {
          runId: context.runId,
          draftId: context.draft.id,
          sceneId: scene.id,
          workerId: context.workerId,
          errorCode: code,
        });
        throw new SceneActionsError(code);
      }
    }

    return this.generation.completeSceneActionsRun(context.userId, {
      runId: context.runId,
      draftId: context.draft.id,
      workerId: context.workerId,
    });
  }
}

export class SceneActionsError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function sceneActionsPrompt(input: {
  course: ClassroomOutline;
  outline: ClassroomOutline['outlines'][number];
  content: unknown;
  previousSpeeches: string[];
}) {
  const keyPoints = input.outline.keyPoints.map((point, index) => `${index + 1}. ${point}`).join('\n');
  const courseContext = buildCourseContext(
    input.course.outlines.map((outline) => outline.title),
    input.outline.order,
    input.previousSpeeches,
  );
  if (input.outline.type === 'slide') {
    const elements = slideElements(input.content);
    if (!elements) return null;
    const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_SLIDE_ACTIONS, {
      title: input.outline.title,
      keyPoints,
      description: input.outline.description,
      elements: formatElements(elements),
      courseContext,
      agents: '',
      userProfile: '',
      languageDirective: input.course.languageDirective,
    });
    return { id: PROMPT_IDS.CLASSROOM_SLIDE_ACTIONS, ...prompt, user: prompt.user! };
  }
  if (input.outline.type === 'quiz') {
    const questions = quizQuestions(input.content);
    if (!questions) return null;
    const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_QUIZ_ACTIONS, {
      questions: formatQuestions(questions),
      title: input.outline.title,
      keyPoints,
      description: input.outline.description,
      courseContext,
      agents: '',
      languageDirective: input.course.languageDirective,
    });
    return { id: PROMPT_IDS.CLASSROOM_QUIZ_ACTIONS, ...prompt, user: prompt.user! };
  }
  if (input.outline.type === 'interactive') {
    const interactive = interactiveContent(input.content);
    if (!interactive) return null;
    const legacy = input.outline.interactiveConfig ?? {};
    const widget = input.outline.widgetOutline ?? {};
    const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_INTERACTIVE_ACTIONS, {
      title: input.outline.title,
      conceptName: textValue(legacy.conceptName) ?? textValue(widget.concept) ?? input.outline.title,
      description: input.outline.description,
      designIdea: textValue(legacy.designIdea) ?? '',
      keyPoints,
      widgetType: interactive.widgetType,
      widgetConfig: JSON.stringify(interactive.widgetConfig),
      elementInventory: interactiveElementInventory(interactive.html).prompt || '(no interactive elements detected)',
      courseContext,
      agents: '',
      languageDirective: input.course.languageDirective,
    });
    return { id: PROMPT_IDS.CLASSROOM_INTERACTIVE_ACTIONS, ...prompt, user: prompt.user! };
  }
  return null;
}

function buildCourseContext(titles: string[], pageIndex: number, previousSpeeches: string[]) {
  const lines = ['Course Outline:'];
  titles.forEach((title, index) => {
    const marker = index === pageIndex - 1 ? ' ← current' : '';
    lines.push(`  ${index + 1}. ${title}${marker}`);
  });
  lines.push(
    '',
    'IMPORTANT: All pages belong to the SAME class session. Do NOT greet again after the first page. When referencing content from earlier pages, say "we just covered" or "as mentioned on page N" — NEVER say "last class" or "previous session" because there is no previous session.',
    '',
  );
  if (pageIndex === 1) {
    lines.push('Position: This is the FIRST page. Open with a greeting and course introduction.');
  } else if (pageIndex === titles.length) {
    lines.push(
      'Position: This is the LAST page. Conclude the course with a summary and closing.',
      'Transition: Continue naturally from the previous page. Do NOT greet or re-introduce.',
    );
  } else {
    lines.push(
      `Position: Page ${pageIndex} of ${titles.length} (middle of the course).`,
      'Transition: Continue naturally from the previous page. Do NOT greet or re-introduce.',
    );
  }
  const previous = previousSpeeches.at(-1);
  if (previous) {
    lines.push('', 'Previous page speech (for transition reference):', `  "...${previous.slice(-150)}"`);
  }
  return lines.join('\n');
}

function slideElements(content: unknown): Array<Record<string, unknown>> | null {
  if (!content || typeof content !== 'object') return null;
  const canvas = (content as Record<string, unknown>).canvas;
  if (!canvas || typeof canvas !== 'object') return null;
  const elements = (canvas as Record<string, unknown>).elements;
  return Array.isArray(elements) ? elements.filter(isRecord) : null;
}

function quizQuestions(content: unknown): Array<Record<string, unknown>> | null {
  if (!content || typeof content !== 'object') return null;
  const questions = (content as Record<string, unknown>).questions;
  return Array.isArray(questions) ? questions.filter(isRecord) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatElements(elements: Array<Record<string, unknown>>) {
  return elements.map((element) => {
    const id = String(element.id ?? '');
    const type = String(element.type ?? 'unknown');
    let summary = `${type} element`;
    if (type === 'text' && typeof element.content === 'string') {
      const text = element.content.replace(/<[^>]*>/g, '').slice(0, 50);
      summary = `Content summary: "${text}${text.length >= 50 ? '...' : ''}"`;
    } else if (type === 'chart') {
      summary = `Chart type: ${String(element.chartType ?? 'unknown')}`;
    } else if (type === 'image') {
      summary = 'Image element';
    } else if (type === 'shape') {
      summary = `Shape: ${String(element.shapeName ?? 'unknown')}`;
    } else if (type === 'latex') {
      summary = `Formula: ${String(element.latex ?? '').slice(0, 30)}`;
    }
    return `- id: "${id}", type: "${type}", ${summary}`;
  }).join('\n');
}

function formatQuestions(questions: Array<Record<string, unknown>>) {
  return questions.map((question, index) => {
    const options = Array.isArray(question.options)
      ? `Options: ${question.options.map((option) => {
        if (!isRecord(option)) return String(option);
        return `${String(option.value ?? option.id ?? '')}. ${String(option.label ?? option.text ?? '')}`;
      }).join(', ')}`
      : '';
    return `Q${index + 1} (${String(question.type ?? '')}): ${String(question.question ?? '')}\n${options}`;
  }).join('\n\n');
}

function parseSceneActions(
  outline: ClassroomOutline['outlines'][number],
  content: unknown,
  text: string,
): Action[] {
  let items: unknown;
  try {
    items = parseGeneratedJson(text, 'array');
  } catch {
    throw new SceneActionsError('CLASSROOM_SCENE_ACTIONS_INVALID');
  }
  if (!Array.isArray(items)) throw new SceneActionsError('CLASSROOM_SCENE_ACTIONS_INVALID');
  const parsed = items.flatMap((item) => parseStructuredItem(item, outline.type));
  const discussionIndex = parsed.findIndex((action) => action.type === 'discussion');
  const ordered = discussionIndex >= 0 ? parsed.slice(0, discussionIndex + 1) : parsed;
  const actions = outline.type === 'slide'
    ? validateSlideTargets(ordered, slideElements(content) ?? [])
    : outline.type === 'interactive'
      ? validateInteractiveTargets(ordered, content)
      : ordered.filter((action) => action.type === 'speech');
  if (actions.length === 0) throw new SceneActionsError('CLASSROOM_SCENE_ACTIONS_INVALID');
  return actions;
}

function parseStructuredItem(item: unknown, sceneType: string): Action[] {
  if (!isRecord(item)) return [];
  let candidate: Record<string, unknown>;
  if (item.type === 'text') {
    const text = typeof item.content === 'string' ? item.content.trim() : '';
    if (!text) return [];
    candidate = { id: actionId(), type: 'speech', text };
  } else if (item.type === 'action') {
    const name = item.name ?? item.tool_name;
    if (typeof name !== 'string') return [];
    const allowed = sceneType === 'slide'
      ? SLIDE_ACTIONS.has(name)
      : sceneType === 'interactive' && INTERACTIVE_ACTIONS.has(name);
    if (!allowed) return [];
    const params = isRecord(item.params)
      ? item.params
      : isRecord(item.parameters) ? item.parameters : {};
    candidate = { id: actionId(), type: name, ...params };
  } else {
    return [];
  }
  const result = ActionSchema.safeParse(candidate);
  return result.success ? [result.data] : [];
}

function validateInteractiveTargets(actions: Action[], content: unknown) {
  for (const action of actions) {
    if (
      (action.type === 'widget_highlight' || action.type === 'widget_annotation' || action.type === 'widget_reveal')
      && (typeof action.target !== 'string' || !hasInteractiveTarget(content, action.target))
    ) {
      throw new SceneActionsError('CLASSROOM_SCENE_ACTIONS_INVALID');
    }
  }
  return actions;
}

function interactiveContent(value: unknown) {
  if (!isRecord(value) || typeof value.html !== 'string' || typeof value.widgetType !== 'string' || !isRecord(value.widgetConfig)) {
    return null;
  }
  return {
    html: value.html,
    widgetType: value.widgetType,
    widgetConfig: value.widgetConfig,
  };
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateSlideTargets(actions: Action[], elements: Array<Record<string, unknown>>) {
  const ids = new Set(elements.map((element) => element.id).filter((id): id is string => typeof id === 'string'));
  const videoIds = new Set(elements
    .filter((element) => element.type === 'video' && typeof element.id === 'string')
    .map((element) => element.id as string));
  for (const action of actions) {
    if (
      (action.type === 'spotlight' || action.type === 'laser')
      && (typeof action.elementId !== 'string' || !ids.has(action.elementId))
    ) {
      throw new SceneActionsError('CLASSROOM_SCENE_ACTIONS_INVALID');
    }
    if (
      action.type === 'play_video'
      && (typeof action.elementId !== 'string' || !videoIds.has(action.elementId))
    ) {
      throw new SceneActionsError('CLASSROOM_SCENE_ACTIONS_INVALID');
    }
  }
  return actions;
}

function speechTexts(actions: unknown) {
  return Array.isArray(actions)
    ? actions.flatMap((action) => isRecord(action) && action.type === 'speech' && typeof action.text === 'string'
      ? [action.text]
      : [])
    : [];
}

function actionId() {
  return `action_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
}
