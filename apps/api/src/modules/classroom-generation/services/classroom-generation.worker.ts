import { randomUUID } from 'node:crypto';

import { ApiError } from '../../../http/errors';
import {
  LeaseLostError,
  UserAbortError,
  WorkerShutdownError,
} from './classroom-generation.worker-errors';
import type {
  ClassroomGenerationDal,
  ClassroomGenerationWorkerOptions,
} from './classroom-generation.types';
import { OutlineGenerationService } from './outline-generation.service';
import { SceneActionsError, SceneActionsGenerationService } from './scene-actions-generation.service';
import { SceneContentError, SceneContentGenerationService } from './scene-content-generation.service';
import { MediaTasksError, MediaTasksGenerationService } from './media-tasks-generation.service';

const DEFAULT_WORKER_OPTIONS = {
  pollIntervalMs: 1_000,
  leaseDurationMs: 30_000,
  heartbeatIntervalMs: 10_000,
  concurrency: 1,
} as const;

export class ClassroomGenerationWorker {
  private readonly workerId = randomUUID();
  private readonly options: Required<Omit<ClassroomGenerationWorkerOptions, 'onError'>>;
  private readonly onError: (error: unknown) => void;
  private readonly active = new Map<string, { controller: AbortController; task: Promise<void> }>();
  private timer: NodeJS.Timeout | undefined;
  private draining = false;
  private stopping = false;

  constructor(
    private readonly generation: ClassroomGenerationDal,
    private readonly outline: OutlineGenerationService,
    private readonly scenes: SceneContentGenerationService,
    private readonly actions: SceneActionsGenerationService,
    private readonly media: MediaTasksGenerationService,
    options: ClassroomGenerationWorkerOptions = {},
  ) {
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_WORKER_OPTIONS.pollIntervalMs,
      leaseDurationMs: options.leaseDurationMs ?? DEFAULT_WORKER_OPTIONS.leaseDurationMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULT_WORKER_OPTIONS.heartbeatIntervalMs,
      concurrency: options.concurrency ?? DEFAULT_WORKER_OPTIONS.concurrency,
    };
    this.onError = options.onError ?? (() => undefined);
  }

  start() {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => this.wake(), this.options.pollIntervalMs);
    this.timer.unref();
    this.wake();
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const active of this.active.values()) active.controller.abort(new WorkerShutdownError());
    await Promise.allSettled([...this.active.values()].map((active) => active.task));
  }

  wake() {
    if (this.stopping || this.draining) return;
    queueMicrotask(() => void this.drain());
  }

  abort(runId: string) {
    this.active.get(runId)?.controller.abort(new UserAbortError());
  }

  private async drain() {
    if (this.stopping || this.draining) return;
    this.draining = true;
    try {
      while (!this.stopping && this.active.size < this.options.concurrency) {
        const now = new Date();
        const claimed = await this.generation.claimNext(
          this.workerId,
          now,
          new Date(now.getTime() + this.options.leaseDurationMs),
        );
        if (!claimed) break;
        const controller = new AbortController();
        const task = this.processClaim(claimed.userId, claimed.id, controller)
          .catch(this.onError)
          .finally(() => {
            this.active.delete(claimed.id);
            this.wake();
          });
        this.active.set(claimed.id, { controller, task });
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.draining = false;
    }
  }

  private async processClaim(userId: string, runId: string, controller: AbortController) {
    const claimed = await this.generation.getClaimed(userId, runId, this.workerId);
    if (!claimed) return;
    const heartbeat = setInterval(() => {
      const now = new Date();
      void this.generation.renewLease(
        userId,
        runId,
        this.workerId,
        now,
        new Date(now.getTime() + this.options.leaseDurationMs),
      ).then((lease) => {
        if (!lease) controller.abort(new LeaseLostError());
        else if (lease.cancelRequestedAt) controller.abort(new UserAbortError());
      }).catch((error) => {
        this.onError(error);
        controller.abort(new LeaseLostError());
      });
    }, this.options.heartbeatIntervalMs);
    heartbeat.unref();

    try {
      if (claimed.run.cancelRequestedAt) throw new UserAbortError();
      const context = {
        userId,
        runId,
        workerId: this.workerId,
        draft: claimed.draft,
        signal: controller.signal,
      };
      const completed = claimed.run.stage === 'outline'
        ? await this.outline.processClaim(context)
        : claimed.run.stage === 'scene_content'
          ? await this.scenes.processClaim(context)
          : claimed.run.stage === 'scene_actions'
            ? await this.actions.processClaim(context)
            : claimed.run.stage === 'media_tasks'
              ? await this.media.processClaim(context)
            : null;
      if (!['outline', 'scene_content', 'scene_actions', 'media_tasks'].includes(claimed.run.stage)) {
        throw new Error(`Unsupported generation stage: ${claimed.run.stage}`);
      }
      if (!completed) {
        const latest = await this.generation.get(userId, runId);
        if (latest.run.cancelRequestedAt) throw new UserAbortError();
      }
    } catch (error) {
      if (this.stopping || error instanceof WorkerShutdownError || controller.signal.reason instanceof WorkerShutdownError) {
        await this.generation.releaseClaim(userId, runId, this.workerId);
        return;
      }
      if (error instanceof LeaseLostError || controller.signal.reason instanceof LeaseLostError) return;
      if (error instanceof UserAbortError || controller.signal.reason instanceof UserAbortError) {
        await this.generation.abortClaimed(userId, {
          runId,
          draftId: claimed.draft.id,
          workerId: this.workerId,
        });
        return;
      }
      const errorCode = error instanceof SceneContentError || error instanceof SceneActionsError || error instanceof MediaTasksError
        ? error.code
        : error instanceof ApiError && error.code === 'CLASSROOM_OUTLINE_INVALID'
          ? error.code
          : claimed.run.stage === 'scene_actions'
            ? 'CLASSROOM_SCENE_ACTIONS_GENERATION_FAILED'
          : claimed.run.stage === 'scene_content'
            ? 'CLASSROOM_SCENE_CONTENT_GENERATION_FAILED'
            : claimed.run.stage === 'media_tasks'
              ? 'CLASSROOM_MEDIA_GENERATION_FAILED'
            : 'CLASSROOM_OUTLINE_GENERATION_FAILED';
      const failed = await this.generation.failClaimed(userId, {
        runId,
        draftId: claimed.draft.id,
        workerId: this.workerId,
        errorCode,
      });
      if (!failed) {
        const latest = await this.generation.get(userId, runId);
        if (latest.run.cancelRequestedAt) {
          await this.generation.abortClaimed(userId, {
            runId,
            draftId: claimed.draft.id,
            workerId: this.workerId,
          });
        }
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}
