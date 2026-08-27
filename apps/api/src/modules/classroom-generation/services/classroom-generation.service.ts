import { randomUUID } from 'node:crypto';

import type { Database } from '../../../db/client';
import { createClassroomGenerationDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import type { CreateClassroomGenerationRunInput } from '../schemas';
import type { CreateClassroomMediaTasksRunInput } from '../schemas';
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
  private readonly worker;

  constructor(
    db: Database,
    model: ClassroomGenerationModel,
    mediaGenerator: ClassroomMediaGenerator,
    objectStorage: ClassroomObjectStorage,
    options: ClassroomGenerationWorkerOptions = {},
  ) {
    this.generation = createClassroomGenerationDal(db);
    this.outline = new OutlineGenerationService(this.generation, model);
    this.scenes = new SceneContentGenerationService(this.generation, model);
    this.actions = new SceneActionsGenerationService(this.generation, model);
    this.media = new MediaTasksGenerationService(this.generation, mediaGenerator, objectStorage);
    this.publication = new ClassroomPublicationService(this.generation, objectStorage);
    this.worker = new ClassroomGenerationWorker(
      this.generation,
      this.outline,
      this.scenes,
      this.actions,
      this.media,
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
    await this.generation.createOutlineRun(userId, {
      runId,
      draftId,
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
    const scenes = ['scene_content', 'scene_actions', 'media_tasks'].includes(row.run.stage)
      ? await this.generation.listScenes(userId, row.draft.id)
      : [];
    const mediaTasks = row.run.stage === 'media_tasks'
      ? await this.generation.listMediaTasks(userId, runId)
      : [];
    return projectRun(row, scenes, mediaTasks);
  }

  async getCurrentRun(userId: string) {
    const current = await this.generation.getCurrent(userId);
    return current ? this.getRun(userId, current.run.id) : null;
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
    if (!['outline', 'scene_content', 'scene_actions', 'media_tasks'].includes(existing.run.stage)) {
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

function projectRun(
  row: Awaited<ReturnType<ReturnType<typeof createClassroomGenerationDal>['get']>>,
  scenes: Awaited<ReturnType<ReturnType<typeof createClassroomGenerationDal>['listScenes']>>,
  mediaTasks: Awaited<ReturnType<ReturnType<typeof createClassroomGenerationDal>['listMediaTasks']>>,
) {
  const stage = row.run.stage;
  const projectedScenes = scenes.map((scene) => {
    const actionsStage = stage === 'scene_actions' || stage === 'media_tasks';
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
    contentType: task.contentType,
    size: task.size,
    error: task.errorCode ? { code: task.errorCode } : null,
    startedAt: task.startedAt?.toISOString() ?? null,
    finishedAt: task.finishedAt?.toISOString() ?? null,
  }));
  return {
    id: row.run.id,
    draftId: row.draft.id,
    stage: row.run.stage,
    status: row.run.status,
    attempt: row.run.attempt,
    requirements: row.draft.requirements,
    context: row.draft.context,
    prompt: row.run.promptId && row.run.promptRevision
      ? { id: row.run.promptId, revision: row.run.promptRevision }
      : null,
    model: row.run.modelProviderId && row.run.modelId
      ? { providerId: row.run.modelProviderId, modelId: row.run.modelId }
      : null,
    outline: row.draft.outline,
    scenes: projectedScenes,
    mediaTasks: projectedMediaTasks,
    progress: ['scene_content', 'scene_actions', 'media_tasks'].includes(row.run.stage) ? {
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
    } : null,
    error: row.run.errorCode ? { code: row.run.errorCode } : null,
    cancelRequested: row.run.cancelRequestedAt !== null,
    startedAt: row.run.startedAt?.toISOString() ?? null,
    finishedAt: row.run.finishedAt?.toISOString() ?? null,
  };
}
