import { createHash, randomUUID } from 'node:crypto';

import type { Database } from '../../../db/client';
import { createClassroomGenerationDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import type {
  ClassroomDraftContext,
  ClassroomOutline,
  ConfirmClassroomOutlineRevisionInput,
  CreateClassroomGenerationRunInput,
  CreateClassroomMediaTasksRunInput,
} from '../schemas';
import type { ClassroomObjectStorage } from '../../classrooms/services/classroom.service';
import { ClassroomGenerationWorker } from './classroom-generation.worker';
import type {
  ClassroomGenerationModel,
  ClassroomMediaGenerator,
  ClassroomGenerationWorkerOptions,
} from './classroom-generation.types';
import { OutlineGenerationService } from './outline-generation.service';
import { SceneActionsGenerationService } from './scene-actions-generation.service';
import { SceneContentGenerationService } from './scene-content-generation.service';
import { MediaTasksGenerationService } from './media-tasks-generation.service';
import { ClassroomPublicationService } from './classroom-publication.service';
import { ProgressiveGenerationService } from './progressive-generation.service';
import { AgentProfilesGenerationService } from './agent-profiles-generation.service';

export type {
  ClassroomGenerationModel,
  ClassroomMediaGenerator,
  ClassroomGenerationWorkerOptions,
} from './classroom-generation.types';

export class ClassroomGenerationService {
  private readonly generation;
  private readonly outline;
  private readonly scenes;
  private readonly actions;
  private readonly media;
  private readonly publication;
  private readonly progressive;
  private readonly worker;

  constructor(
    db: Database,
    model: ClassroomGenerationModel,
    mediaGenerator: ClassroomMediaGenerator,
    private readonly objectStorage: ClassroomObjectStorage,
    options: ClassroomGenerationWorkerOptions = {},
  ) {
    this.generation = createClassroomGenerationDal(db);
    this.outline = new OutlineGenerationService(this.generation, model);
    this.scenes = new SceneContentGenerationService(this.generation, model);
    this.actions = new SceneActionsGenerationService(this.generation, model);
    this.media = new MediaTasksGenerationService(this.generation, mediaGenerator, objectStorage);
    this.publication = new ClassroomPublicationService(this.generation, objectStorage);
    this.progressive = new ProgressiveGenerationService(
      this.generation,
      this.scenes,
      this.actions,
      this.media,
      new AgentProfilesGenerationService(model),
    );
    this.worker = new ClassroomGenerationWorker(
      this.generation,
      this.outline,
      this.scenes,
      this.actions,
      this.media,
      this.progressive,
      options,
    );
  }

  startWorker() {
    this.worker.start();
  }

  async stopWorker() {
    await this.worker.stop();
  }

  async createOutlineRun(userId: string, input: CreateClassroomGenerationRunInput) {
    const context = {
      ...input.context,
      ...(input.media ? { media: input.media } : {}),
    };
    const prompt = this.outline.getPromptMetadata(input.requirements, context);
    const runId = randomUUID();
    const draftId = randomUUID();
    const classroomId = randomUUID();
    await this.generation.createOutlineRun(userId, {
      runId,
      draftId,
      classroomId,
      title: provisionalClassroomTitle(input.requirements),
      requirements: input.requirements,
      context,
      promptId: prompt.id,
      promptRevision: prompt.revision,
    });
    this.worker.wake();
    return this.getRun(userId, runId);
  }

  async getRun(userId: string, runId: string) {
    const row = await this.generation.get(userId, runId);
    const scenes = ['scene_content', 'scene_actions', 'media_tasks', 'progressive'].includes(row.run.stage)
      ? await this.generation.listScenes(userId, row.draft.id)
      : [];
    const mediaTasks = ['media_tasks', 'progressive'].includes(row.run.stage)
      ? await this.generation.listMediaTasks(userId, runId)
      : [];
    const mediaUrls = new Map(await Promise.all(mediaTasks.flatMap((task) => (
      task.status === 'completed' && task.mediaRef && task.objectKey
        ? [this.objectStorage.createDownloadUrl(task.objectKey).then((url) => [task.mediaRef!, url] as const)]
        : []
    ))));
    return projectRun(row, scenes, mediaTasks, mediaUrls);
  }

  async getCurrentRun(userId: string) {
    const current = await this.generation.getCurrent(userId);
    return current ? this.getRun(userId, current.run.id) : null;
  }

  listOutlineEvents(userId: string, runId: string, afterId = 0) {
    return this.generation.listOutlineEvents(userId, runId, afterId);
  }

  async confirmOutlineRevision(
    userId: string,
    outlineRunId: string,
    input: ConfirmClassroomOutlineRevisionInput,
  ) {
    const source = await this.generation.get(userId, outlineRunId);
    if (source.run.stage !== 'outline' || source.run.status !== 'completed' || !source.draft.outline) {
      throw new ApiError(409, 'Outline confirmation requires a completed outline run', 'CLASSROOM_OUTLINE_REVISION_NOT_READY');
    }
    if (input.outline.outlines.some((scene) => scene.type === 'pbl')) {
      throw new ApiError(422, 'PBL scenes are outside Chalkboard V3', 'CLASSROOM_OUTLINE_TYPE_UNSUPPORTED');
    }
    const outline = input.outline as ClassroomOutline;
    const revisionId = randomUUID();
    const runId = randomUUID();
    const scenes = outline.outlines.map((scene) => ({
      id: randomUUID(),
      outlineId: scene.id,
      type: scene.type,
      order: scene.order,
      outline: scene,
    }));
    const existingContext = readDraftContext(source.draft.context);
    const context: ClassroomDraftContext = existingContext;
    const mediaTasks = planProgressiveMediaTasks(outline, context, scenes);
    const contentHash = createHash('sha256').update(JSON.stringify(outline)).digest('hex');
    const result = await this.generation.confirmOutlineRevision(userId, {
      outlineRunId,
      runId,
      revisionId,
      draftId: source.draft.id,
      idempotencyKey: input.idempotencyKey,
      candidateVersion: input.candidateVersion,
      outline,
      context,
      contentHash,
      scenes,
      mediaTasks,
    });
    if (result.state === 'conflict') {
      throw new ApiError(409, 'The outline revision idempotency key is already bound', 'CLASSROOM_OUTLINE_REVISION_CONFLICT');
    }
    if (result.state === 'stale') {
      throw new ApiError(409, 'The outline candidate changed before confirmation', 'CLASSROOM_OUTLINE_CANDIDATE_STALE');
    }
    if (result.state === 'created') this.worker.wake();
    return {
      created: result.state === 'created',
      outlineRevision: {
        id: result.revision.id,
        number: result.revision.number,
        outline: result.revision.outline,
        contentHash: result.revision.contentHash,
        createdAt: result.revision.createdAt.toISOString(),
      },
      generationRun: await this.getRun(userId, result.run.id),
    };
  }

  async createSceneContentRun(userId: string, outlineRunId: string) {
    const runId = await this.scenes.createRun(userId, outlineRunId);
    this.worker.wake();
    return this.getRun(userId, runId);
  }

  async createSceneActionsRun(userId: string, contentRunId: string) {
    const runId = await this.actions.createRun(userId, contentRunId);
    this.worker.wake();
    return this.getRun(userId, runId);
  }

  async createMediaTasksRun(userId: string, actionsRunId: string, input: CreateClassroomMediaTasksRunInput) {
    const runId = await this.media.createRun(userId, actionsRunId, input);
    this.worker.wake();
    return this.getRun(userId, runId);
  }

  publishRun(userId: string, runId: string) {
    return this.publication.publish(userId, runId);
  }

  async retryRun(userId: string, runId: string) {
    const existing = await this.generation.get(userId, runId);
    if (!['outline', 'scene_content', 'scene_actions', 'media_tasks', 'progressive'].includes(existing.run.stage)) {
      throw new ApiError(409, 'This classroom generation stage cannot be retried', 'CLASSROOM_GENERATION_RETRY_NOT_ALLOWED');
    }
    const prompt = existing.run.stage === 'outline'
      ? this.outline.getPromptMetadata(existing.draft.requirements, existing.draft.context)
      : null;
    const started = await this.generation.startRetry(userId, {
      runId,
      draftId: existing.draft.id,
      promptId: prompt?.id ?? null,
      promptRevision: prompt?.revision ?? null,
    });
    if (!started) {
      throw new ApiError(409, 'Only failed classroom generation runs can be retried', 'CLASSROOM_GENERATION_RETRY_NOT_ALLOWED');
    }
    this.worker.wake();
    return this.getRun(userId, runId);
  }

  async abortRun(userId: string, runId: string) {
    const requested = await this.generation.requestAbort(userId, runId);
    if (!requested) {
      throw new ApiError(409, 'Only queued or running classroom generation runs can be aborted', 'CLASSROOM_GENERATION_ABORT_NOT_ALLOWED');
    }
    this.worker.abort(runId);
    return this.getRun(userId, runId);
  }
}

function provisionalClassroomTitle(requirements: string) {
  const firstLine = requirements.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  return (firstLine || '正在准备的新课堂').slice(0, 120);
}

function readDraftContext(value: unknown): ClassroomDraftContext {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ClassroomDraftContext : {};
}

function planProgressiveMediaTasks(
  outline: ClassroomOutline,
  context: ClassroomDraftContext,
  scenes: Array<{ id: string; outlineId: string }>,
) {
  return outline.outlines.flatMap((sceneOutline) => {
    const scene = scenes.find((candidate) => candidate.outlineId === sceneOutline.id)!;
    return (sceneOutline.mediaGenerations ?? []).map((request) => {
      const config = request.type === 'image' ? context.media?.image : context.media?.video;
      if (!config) {
        throw new ApiError(409, 'Planned media is not configured for this draft', 'CLASSROOM_MEDIA_TASKS_NOT_READY');
      }
      return {
        id: randomUUID(),
        sceneId: scene.id,
        actionId: null,
        elementId: request.elementId,
        taskKey: `${scene.id}:${request.elementId}:${request.type}`,
        kind: request.type,
        input: {
          ...config,
          prompt: request.prompt,
          elementId: request.elementId,
          ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
          ...(request.style ? { style: request.style } : {}),
        },
      };
    });
  }).map((task, taskOrder) => ({ ...task, taskOrder }));
}

function projectRun(
  row: Awaited<ReturnType<ReturnType<typeof createClassroomGenerationDal>['get']>>,
  scenes: Awaited<ReturnType<ReturnType<typeof createClassroomGenerationDal>['listScenes']>>,
  mediaTasks: Awaited<ReturnType<ReturnType<typeof createClassroomGenerationDal>['listMediaTasks']>>,
  mediaUrls: ReadonlyMap<string, string>,
) {
  const stage = row.run.stage;
  const projectedScenes = scenes.map((scene) => {
    const actionsStage = stage === 'scene_actions'
      || stage === 'media_tasks'
      || (stage === 'progressive' && scene.status === 'completed');
    const status = actionsStage ? scene.actionStatus : scene.status;
    return {
      id: scene.id,
      outlineId: scene.outlineId,
      type: scene.type,
      order: scene.order,
      outline: scene.outline,
      content: scene.content,
      actions: scene.actions,
      status,
      phase: scene.status !== 'completed'
        ? 'content'
        : scene.actionStatus !== 'completed' ? 'actions' : 'completed',
      attempt: actionsStage ? scene.actionAttempt : scene.attempt,
      prompt: (actionsStage ? scene.actionPromptId : scene.promptId)
        && (actionsStage ? scene.actionPromptRevision : scene.promptRevision)
        ? {
          id: (actionsStage ? scene.actionPromptId : scene.promptId)!,
          revision: (actionsStage ? scene.actionPromptRevision : scene.promptRevision)!,
        }
        : null,
      model: (actionsStage ? scene.actionModelProviderId : scene.modelProviderId)
        && (actionsStage ? scene.actionModelId : scene.modelId)
        ? {
          providerId: (actionsStage ? scene.actionModelProviderId : scene.modelProviderId)!,
          modelId: (actionsStage ? scene.actionModelId : scene.modelId)!,
        }
        : null,
      error: (actionsStage ? scene.actionErrorCode : scene.errorCode)
        ? { code: (actionsStage ? scene.actionErrorCode : scene.errorCode)! }
        : null,
      startedAt: (actionsStage ? scene.actionStartedAt : scene.startedAt)?.toISOString() ?? null,
      finishedAt: (actionsStage ? scene.actionFinishedAt : scene.finishedAt)?.toISOString() ?? null,
    };
  });
  const projectedMediaTasks = mediaTasks.map((task) => ({
    id: task.id,
    sceneId: task.sceneId,
    actionId: task.actionId,
    elementId: task.elementId,
    providerTaskId: task.providerTaskId,
    kind: task.kind,
    status: task.status,
    attempt: task.attempt,
    providerId: task.providerId,
    modelId: task.modelId,
    mediaRef: task.mediaRef,
    url: task.mediaRef ? mediaUrls.get(task.mediaRef) ?? null : null,
    contentType: task.contentType,
    size: task.size,
    error: task.errorCode ? { code: task.errorCode } : null,
    startedAt: task.startedAt?.toISOString() ?? null,
    finishedAt: task.finishedAt?.toISOString() ?? null,
  }));
  return {
    id: row.run.id,
    classroomId: row.draft.classroomId,
    draftId: row.draft.id,
    outlineRevisionId: row.run.outlineRevisionId,
    draftStatus: row.draft.status,
    stage: row.run.stage,
    status: row.run.status,
    attempt: row.run.attempt,
    requirements: row.draft.requirements,
    context: row.draft.context,
    candidateVersion: row.run.stage === 'outline' && row.draft.outline
      ? createHash('sha256').update(JSON.stringify(row.draft.outline)).digest('hex')
      : null,
    prompt: row.run.promptId && row.run.promptRevision
      ? { id: row.run.promptId, revision: row.run.promptRevision }
      : null,
    model: row.run.modelProviderId && row.run.modelId
      ? { providerId: row.run.modelProviderId, modelId: row.run.modelId }
      : null,
    outline: row.draft.outline,
    scenes: projectedScenes,
    mediaTasks: projectedMediaTasks,
    previewReady: stage === 'progressive' && projectedScenes[0]?.phase === 'completed',
    publishReady: stage === 'progressive' && row.run.status === 'completed',
    progress: ['scene_content', 'scene_actions', 'media_tasks', 'progressive'].includes(row.run.stage) ? {
      total: stage === 'media_tasks' ? projectedMediaTasks.length : projectedScenes.length,
      completed: stage === 'media_tasks'
        ? projectedMediaTasks.filter((task) => task.status === 'completed').length
        : projectedScenes.filter((scene) => scene.status === 'completed').length,
      failed: stage === 'media_tasks'
        ? projectedMediaTasks.filter((task) => task.status === 'failed').length
        : projectedScenes.filter((scene) => scene.status === 'failed').length,
      currentSceneId: stage === 'media_tasks'
        ? projectedMediaTasks.find((task) => task.status === 'running')?.sceneId ?? null
        : projectedScenes.find((scene) => scene.status === 'running')?.outlineId ?? null,
      media: stage === 'progressive' ? {
        total: projectedMediaTasks.length,
        completed: projectedMediaTasks.filter((task) => task.status === 'completed').length,
        failed: projectedMediaTasks.filter((task) => task.status === 'failed').length,
      } : null,
    } : null,
    error: row.run.errorCode ? { code: row.run.errorCode } : null,
    cancelRequested: row.run.cancelRequestedAt !== null,
    startedAt: row.run.startedAt?.toISOString() ?? null,
    finishedAt: row.run.finishedAt?.toISOString() ?? null,
  };
}
