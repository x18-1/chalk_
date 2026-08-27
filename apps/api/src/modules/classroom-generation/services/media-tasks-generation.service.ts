import { createHash, randomUUID } from 'node:crypto';

import type { ClassroomObjectStorage } from '../../classrooms/services/classroom.service';
import { ApiError } from '../../../http/errors';
import type { CreateClassroomMediaTasksRunInput } from '../schemas';
import {
  classroomOutlineSchema,
  type ClassroomDraftContext,
  type ClassroomMediaPlanningConfig,
} from '../schemas';
import type {
  ClassroomGenerationDal,
  ClassroomMediaGenerator,
  GenerationClaimContext,
} from './classroom-generation.types';
import { LeaseLostError, UserAbortError } from './classroom-generation.worker-errors';

type TtsTaskInput = NonNullable<CreateClassroomMediaTasksRunInput['tts']> & { text: string };
type ImageTaskInput = NonNullable<ClassroomMediaPlanningConfig['image']> & {
  prompt: string;
  elementId: string;
  style?: string;
};
type VideoTaskInput = NonNullable<ClassroomMediaPlanningConfig['video']> & {
  prompt: string;
  elementId: string;
  style?: string;
};

export class MediaTasksGenerationService {
  constructor(
    private readonly generation: ClassroomGenerationDal,
    private readonly generator: ClassroomMediaGenerator,
    private readonly objectStorage: ClassroomObjectStorage,
  ) {}

  async createRun(userId: string, actionsRunId: string, input: CreateClassroomMediaTasksRunInput) {
    const source = await this.generation.get(userId, actionsRunId);
    if (source.run.stage !== 'scene_actions' || source.run.status !== 'completed') {
      throw new ApiError(409, 'Media tasks require completed scene actions', 'CLASSROOM_MEDIA_TASKS_NOT_READY');
    }
    const scenes = await this.generation.listScenes(userId, source.draft.id);
    const runId = randomUUID();
    const audioTasks = input.tts
      ? scenes.flatMap((scene) => speechActions(scene.actions).map((action) => ({ scene, action })))
        .map(({ scene, action }) => ({
          id: randomUUID(),
          sceneId: scene.id,
          actionId: action.id,
          elementId: null,
          taskKey: `${scene.id}:${action.id}:audio`,
          kind: 'audio' as const,
          input: { ...input.tts, text: action.text },
        }))
      : [];
    const context = readDraftContext(source.draft.context);
    const course = classroomOutlineSchema.parse(source.draft.outline);
    const imageConfig = context.media?.image;
    const imageTasks = scenes.flatMap((scene) => {
      const outline = course.outlines.find((candidate) => candidate.id === scene.outlineId);
      return (outline?.mediaGenerations ?? [])
        .filter((request) => request.type === 'image')
        .map((request) => ({ scene, request }));
    }).map(({ scene, request }) => {
      if (!imageConfig) throw new ApiError(409, 'Image generation was not configured for this draft', 'CLASSROOM_MEDIA_TASKS_NOT_READY');
      return {
        id: randomUUID(),
        sceneId: scene.id,
        actionId: null,
        elementId: request.elementId,
        taskKey: `${scene.id}:${request.elementId}:image`,
        kind: 'image' as const,
        input: {
          ...imageConfig,
          prompt: request.prompt,
          elementId: request.elementId,
          ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
          ...(request.style ? { style: request.style } : {}),
        },
      };
    });
    const videoConfig = context.media?.video;
    const videoTasks = scenes.flatMap((scene) => {
      const outline = course.outlines.find((candidate) => candidate.id === scene.outlineId);
      return (outline?.mediaGenerations ?? [])
        .filter((request) => request.type === 'video')
        .map((request) => ({ scene, request }));
    }).map(({ scene, request }) => {
      if (!videoConfig) throw new ApiError(409, 'Video generation was not configured for this draft', 'CLASSROOM_MEDIA_TASKS_NOT_READY');
      return {
        id: randomUUID(),
        sceneId: scene.id,
        actionId: null,
        elementId: request.elementId,
        taskKey: `${scene.id}:${request.elementId}:video`,
        kind: 'video' as const,
        input: {
          ...videoConfig,
          prompt: request.prompt,
          elementId: request.elementId,
          ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
          ...(request.style ? { style: request.style } : {}),
        },
      };
    });
    const tasks = [...audioTasks, ...imageTasks, ...videoTasks].map((task, taskOrder) => ({ ...task, taskOrder }));
    const created = await this.generation.createMediaTasksRun(userId, {
      runId,
      actionsRunId,
      draftId: source.draft.id,
      tasks,
    });
    if (!created) {
      throw new ApiError(409, 'Media task generation already exists for this draft', 'CLASSROOM_MEDIA_TASKS_EXISTS');
    }
    return runId;
  }

  async processClaim(context: GenerationClaimContext) {
    const tasks = await this.generation.listMediaTasks(context.userId, context.runId);
    for (const task of tasks) {
      if (task.status === 'completed') continue;
      context.signal.throwIfAborted();
      const started = await this.generation.startMediaTask(context.userId, {
        runId: context.runId,
        draftId: context.draft.id,
        taskId: task.id,
        workerId: context.workerId,
      });
      if (!started) throw new LeaseLostError();

      let storedObjectKey: string | null = null;
      try {
        const generated = task.kind === 'audio'
          ? await this.generator.synthesize(context.userId, {
            ...readTtsTaskInput(task.input),
            signal: context.signal,
          })
          : task.kind === 'image'
            ? await this.generator.generateImage(context.userId, {
              ...readImageTaskInput(task.input),
              signal: context.signal,
            })
            : task.kind === 'video'
              ? await this.generateVideo(context, task)
            : null;
        if (!generated) throw new Error(`Unsupported media task kind: ${task.kind}`);
        context.signal.throwIfAborted();
        const extension = safeExtension(generated.format, task.kind);
        const mediaRef = `media/generated/${task.id}.${extension}`;
        const objectKey = `classroom-drafts/${context.userId}/${context.draft.id}/${mediaRef}`;
        await this.objectStorage.putObject({
          fileKey: objectKey,
          body: generated.bytes,
          contentType: generated.contentType,
        });
        storedObjectKey = objectKey;
        context.signal.throwIfAborted();
        const saved = await this.generation.completeMediaTask(context.userId, {
          runId: context.runId,
          draftId: context.draft.id,
          taskId: task.id,
          sceneId: task.sceneId,
          actionId: task.actionId,
          elementId: task.elementId,
          kind: task.kind as 'audio' | 'image' | 'video',
          workerId: context.workerId,
          providerId: generated.providerId,
          modelId: generated.modelId,
          mediaRef,
          objectKey,
          contentType: generated.contentType,
          size: generated.bytes.byteLength,
          contentHash: createHash('sha256').update(generated.bytes).digest('hex'),
        });
        if (!saved) {
          await this.objectStorage.deleteObject?.(objectKey).catch(() => undefined);
          throw new LeaseLostError();
        }
        storedObjectKey = null;
      } catch (error) {
        if (storedObjectKey) await this.objectStorage.deleteObject?.(storedObjectKey).catch(() => undefined);
        if (context.signal.aborted || error instanceof LeaseLostError) throw error;
        await this.generation.failMediaTask(context.userId, {
          runId: context.runId,
          taskId: task.id,
          workerId: context.workerId,
          errorCode: 'CLASSROOM_MEDIA_GENERATION_FAILED',
        });
        throw new MediaTasksError('CLASSROOM_MEDIA_GENERATION_FAILED');
      }
    }
    return this.generation.completeMediaTasksRun(context.userId, {
      runId: context.runId,
      draftId: context.draft.id,
      workerId: context.workerId,
    });
  }

  private async generateVideo(
    context: GenerationClaimContext,
    task: Awaited<ReturnType<ClassroomGenerationDal['listMediaTasks']>>[number],
  ) {
    const input = readVideoTaskInput(task.input);
    let providerTaskId = task.providerTaskId;
    let providerId = task.providerId ?? input.providerId;
    let modelId = task.modelId ?? input.model ?? 'provider-default';
    try {
      if (!providerTaskId) {
        const submitted = await this.generator.submitVideo(context.userId, {
          ...input,
          signal: context.signal,
        });
        context.signal.throwIfAborted();
        providerTaskId = submitted.providerTaskId;
        providerId = submitted.providerId;
        modelId = submitted.modelId;
        const saved = await this.generation.saveMediaTaskProviderTask(context.userId, {
          runId: context.runId,
          draftId: context.draft.id,
          taskId: task.id,
          workerId: context.workerId,
          providerId,
          modelId,
          providerTaskId,
        });
        if (!saved) throw new LeaseLostError();
      }

      while (true) {
        context.signal.throwIfAborted();
        const result = await this.generator.pollVideo(context.userId, {
          providerTaskId,
          providerId: providerId as VideoTaskInput['providerId'],
          modelId,
          signal: context.signal,
        });
        if (result.status === 'failed') throw result.error ?? new Error('Video provider task failed');
        if (result.status === 'done') return { ...result, providerId, modelId };
        await abortableDelay(1_000, context.signal);
      }
    } catch (error) {
      if (context.signal.reason instanceof UserAbortError && providerTaskId && this.generator.cancelVideo) {
        await this.generator.cancelVideo(context.userId, {
          providerTaskId,
          providerId: providerId as VideoTaskInput['providerId'],
          modelId,
          signal: AbortSignal.timeout(5_000),
        }).catch(() => undefined);
      }
      throw error;
    }
  }
}

export class MediaTasksError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function speechActions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((action): Array<{ id: string; text: string }> => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return [];
    const record = action as Record<string, unknown>;
    return record.type === 'speech' && typeof record.id === 'string' && typeof record.text === 'string' && record.text.trim()
      ? [{ id: record.id, text: record.text.trim() }]
      : [];
  });
}

function readTtsTaskInput(value: unknown): TtsTaskInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid TTS media task input');
  const input = value as Record<string, unknown>;
  if (typeof input.providerId !== 'string' || typeof input.voice !== 'string' || typeof input.text !== 'string') {
    throw new Error('Invalid TTS media task input');
  }
  return {
    providerId: input.providerId as TtsTaskInput['providerId'],
    voice: input.voice,
    text: input.text,
    ...(typeof input.model === 'string' ? { model: input.model } : {}),
    ...(typeof input.format === 'string' ? { format: input.format as TtsTaskInput['format'] } : {}),
  };
}

function readImageTaskInput(value: unknown): ImageTaskInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid image media task input');
  const input = value as Record<string, unknown>;
  if (typeof input.providerId !== 'string' || typeof input.prompt !== 'string' || typeof input.elementId !== 'string') {
    throw new Error('Invalid image media task input');
  }
  return {
    providerId: input.providerId as ImageTaskInput['providerId'],
    prompt: typeof input.style === 'string' ? `${input.prompt}\nVisual style: ${input.style}` : input.prompt,
    elementId: input.elementId,
    ...(typeof input.model === 'string' ? { model: input.model } : {}),
    ...(typeof input.aspectRatio === 'string' ? { aspectRatio: input.aspectRatio as ImageTaskInput['aspectRatio'] } : {}),
    ...(typeof input.width === 'number' ? { width: input.width } : {}),
    ...(typeof input.height === 'number' ? { height: input.height } : {}),
    ...(typeof input.negativePrompt === 'string' ? { negativePrompt: input.negativePrompt } : {}),
  };
}

function readVideoTaskInput(value: unknown): VideoTaskInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid video media task input');
  const input = value as Record<string, unknown>;
  if (typeof input.providerId !== 'string' || typeof input.prompt !== 'string' || typeof input.elementId !== 'string') {
    throw new Error('Invalid video media task input');
  }
  return {
    providerId: input.providerId as VideoTaskInput['providerId'],
    prompt: typeof input.style === 'string' ? `${input.prompt}\nVisual style: ${input.style}` : input.prompt,
    elementId: input.elementId,
    ...(typeof input.model === 'string' ? { model: input.model } : {}),
    ...(typeof input.aspectRatio === 'string' ? { aspectRatio: input.aspectRatio as VideoTaskInput['aspectRatio'] } : {}),
    ...(typeof input.durationSeconds === 'number' ? { durationSeconds: input.durationSeconds } : {}),
    ...(typeof input.resolution === 'string' ? { resolution: input.resolution as VideoTaskInput['resolution'] } : {}),
  };
}

function readDraftContext(value: unknown): ClassroomDraftContext {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ClassroomDraftContext : {};
}

function safeExtension(value: string, kind: string) {
  const allowed = kind === 'image'
    ? ['png', 'jpg', 'jpeg', 'webp', 'gif']
    : kind === 'video' ? ['mp4', 'webm', 'mov'] : ['mp3', 'opus', 'wav', 'aac', 'flac', 'pcm'];
  return allowed.includes(value) ? value : 'bin';
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', aborted, { once: true });
  });
}
