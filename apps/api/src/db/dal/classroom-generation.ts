import { createHash } from 'node:crypto';

import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import {
  classroomArtifactMedia,
  classroomArtifacts,
  classroomDraftMediaTasks,
  classroomDraftScenes,
  classroomDrafts,
  classroomGenerationRuns,
  classroomOutlineEvents,
  classroomOutlineRevisions,
  classrooms,
} from '../schema';

function requireUserId(userId: string) {
  if (!userId) throw new AuthRequiredError();
}

export function createClassroomGenerationDal(db: Database) {
  return {
    async createOutlineRun(userId: string, input: {
      runId: string;
      draftId: string;
      classroomId: string;
      title: string;
      requirements: string;
      context: unknown;
      promptId: string;
      promptRevision: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const classroomRows = await transaction.insert(classrooms).values({
          id: input.classroomId,
          userId,
          title: input.title,
          description: input.requirements,
        }).returning();
        const drafts = await transaction.insert(classroomDrafts).values({
          id: input.draftId,
          userId,
          requirements: input.requirements,
          context: input.context,
          classroomId: input.classroomId,
        }).returning();
        const runs = await transaction.insert(classroomGenerationRuns).values({
          id: input.runId,
          draftId: input.draftId,
          userId,
          status: 'queued',
          promptId: input.promptId,
          promptRevision: input.promptRevision,
        }).returning();
        return { classroom: classroomRows[0]!, draft: drafts[0]!, run: runs[0]! };
      });
    },

    async confirmOutlineRevision(userId: string, input: {
      outlineRunId: string;
      runId: string;
      revisionId: string;
      draftId: string;
      idempotencyKey: string;
      candidateVersion: string;
      outline: unknown;
      context: unknown;
      contentHash: string;
      scenes: Array<{
        id: string;
        outlineId: string;
        type: string;
        order: number;
        outline: unknown;
      }>;
      mediaTasks: Array<{
        id: string;
        sceneId: string;
        actionId: string | null;
        elementId: string | null;
        taskKey: string;
        taskOrder: number;
        kind: 'image' | 'video';
        input: unknown;
      }>;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const sources = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.outlineRunId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.stage, 'outline'),
            eq(classroomGenerationRuns.status, 'completed'),
          ))
          .limit(1)
          .for('update');
        if (!sources[0]) throw new OwnershipError('completed classroom outline run', input.outlineRunId);

        const existingRows = await transaction.select()
          .from(classroomOutlineRevisions)
          .where(and(
            eq(classroomOutlineRevisions.draftId, input.draftId),
            eq(classroomOutlineRevisions.userId, userId),
          ))
          .orderBy(asc(classroomOutlineRevisions.number))
          .limit(1)
          .for('update');
        const existing = existingRows[0];
        if (existing) {
          if (existing.idempotencyKey !== input.idempotencyKey || existing.contentHash !== input.contentHash) {
            return { state: 'conflict' as const };
          }
          const runs = await transaction.select().from(classroomGenerationRuns).where(and(
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.outlineRevisionId, existing.id),
            eq(classroomGenerationRuns.stage, 'progressive'),
          )).limit(1);
          if (!runs[0]) throw new OwnershipError('progressive classroom generation run', input.draftId);
          return { state: 'existing' as const, revision: existing, run: runs[0] };
        }

        const candidateRows = await transaction.select({ outline: classroomDrafts.outline })
          .from(classroomDrafts)
          .where(and(
            eq(classroomDrafts.id, input.draftId),
            eq(classroomDrafts.userId, userId),
          ))
          .limit(1)
          .for('update');
        const candidate = candidateRows[0]?.outline;
        const candidateVersion = candidate
          ? createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
          : null;
        if (candidateVersion !== input.candidateVersion) return { state: 'stale' as const };

        const courseTitle = input.outline
          && typeof input.outline === 'object'
          && !Array.isArray(input.outline)
          && typeof (input.outline as Record<string, unknown>).courseTitle === 'string'
          ? ((input.outline as Record<string, unknown>).courseTitle as string).trim()
          : '';
        if (courseTitle) {
          const ownedDrafts = await transaction.select({ classroomId: classroomDrafts.classroomId })
            .from(classroomDrafts)
            .where(and(
              eq(classroomDrafts.id, input.draftId),
              eq(classroomDrafts.userId, userId),
            ))
            .limit(1);
          if (ownedDrafts[0]?.classroomId) {
            await transaction.update(classrooms).set({
              title: courseTitle,
              updatedAt: new Date(),
            }).where(and(
              eq(classrooms.id, ownedDrafts[0].classroomId),
              eq(classrooms.userId, userId),
            ));
          }
        }

        const revisions = await transaction.insert(classroomOutlineRevisions).values({
          id: input.revisionId,
          draftId: input.draftId,
          userId,
          number: 1,
          idempotencyKey: input.idempotencyKey,
          outline: input.outline,
          contentHash: input.contentHash,
        }).returning();
        const runs = await transaction.insert(classroomGenerationRuns).values({
          id: input.runId,
          draftId: input.draftId,
          userId,
          outlineRevisionId: input.revisionId,
          stage: 'progressive',
          status: 'queued',
          promptId: null,
          promptRevision: null,
        }).returning();
        await transaction.insert(classroomDraftScenes).values(input.scenes.map((scene) => ({
          ...scene,
          draftId: input.draftId,
          userId,
          outlineRevisionId: input.revisionId,
        })));
        if (input.mediaTasks.length > 0) {
          await transaction.insert(classroomDraftMediaTasks).values(input.mediaTasks.map((task) => ({
            ...task,
            runId: input.runId,
            draftId: input.draftId,
            userId,
          })));
        }
        await transaction.update(classroomDrafts).set({
          outline: input.outline,
          context: input.context,
          status: 'generating_progressive',
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
        ));
        return { state: 'created' as const, revision: revisions[0]!, run: runs[0]! };
      });
    },

    async createSceneContentRun(userId: string, input: {
      runId: string;
      outlineRunId: string;
      draftId: string;
      scenes: Array<{ outlineId: string; type: string; order: number; outline: unknown }>;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const sources = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.outlineRunId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.stage, 'outline'),
            eq(classroomGenerationRuns.status, 'completed'),
          ))
          .limit(1);
        if (!sources[0]) throw new OwnershipError('completed classroom outline run', input.outlineRunId);
        const runs = await transaction.insert(classroomGenerationRuns).values({
          id: input.runId,
          draftId: input.draftId,
          userId,
          stage: 'scene_content',
          status: 'queued',
          promptId: null,
          promptRevision: null,
        }).onConflictDoNothing().returning();
        if (!runs[0]) return null;
        await transaction.insert(classroomDraftScenes).values(input.scenes.map((scene) => ({
          draftId: input.draftId,
          userId,
          outlineId: scene.outlineId,
          type: scene.type,
          order: scene.order,
          outline: scene.outline,
        })));
        await transaction.update(classroomDrafts).set({
          status: 'generating_content',
          updatedAt: new Date(),
        }).where(and(eq(classroomDrafts.id, input.draftId), eq(classroomDrafts.userId, userId)));
        return runs[0] ?? null;
      });
    },

    async createSceneActionsRun(userId: string, input: {
      runId: string;
      contentRunId: string;
      draftId: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const sources = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.contentRunId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.stage, 'scene_content'),
            eq(classroomGenerationRuns.status, 'completed'),
          ))
          .limit(1);
        if (!sources[0]) throw new OwnershipError('completed scene content run', input.contentRunId);
        const runs = await transaction.insert(classroomGenerationRuns).values({
          id: input.runId,
          draftId: input.draftId,
          userId,
          stage: 'scene_actions',
          status: 'queued',
          promptId: null,
          promptRevision: null,
        }).onConflictDoNothing().returning();
        if (!runs[0]) return null;
        const scenes = await transaction.select({ id: classroomDraftScenes.id })
          .from(classroomDraftScenes)
          .where(and(
            eq(classroomDraftScenes.draftId, input.draftId),
            eq(classroomDraftScenes.userId, userId),
            eq(classroomDraftScenes.status, 'completed'),
          ));
        if (scenes.length === 0) throw new OwnershipError('completed classroom draft scenes', input.draftId);
        await transaction.update(classroomDrafts).set({
          status: 'generating_actions',
          updatedAt: new Date(),
        }).where(and(eq(classroomDrafts.id, input.draftId), eq(classroomDrafts.userId, userId)));
        return runs[0];
      });
    },

    async createMediaTasksRun(userId: string, input: {
      runId: string;
      actionsRunId: string;
      draftId: string;
      tasks: Array<{
        id: string;
        sceneId: string;
        actionId: string | null;
        elementId: string | null;
        taskKey: string;
        taskOrder: number;
        kind: 'audio' | 'image' | 'video';
        input: unknown;
      }>;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const sources = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.actionsRunId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.stage, 'scene_actions'),
            eq(classroomGenerationRuns.status, 'completed'),
          ))
          .limit(1);
        if (!sources[0]) throw new OwnershipError('completed scene actions run', input.actionsRunId);
        const runs = await transaction.insert(classroomGenerationRuns).values({
          id: input.runId,
          draftId: input.draftId,
          userId,
          stage: 'media_tasks',
          status: 'queued',
          promptId: null,
          promptRevision: null,
        }).onConflictDoNothing().returning();
        if (!runs[0]) return null;
        if (input.tasks.length > 0) {
          await transaction.insert(classroomDraftMediaTasks).values(input.tasks.map((task) => ({
            ...task,
            runId: input.runId,
            draftId: input.draftId,
            userId,
          })));
        }
        await transaction.update(classroomDrafts).set({
          status: 'generating_media',
          updatedAt: new Date(),
        }).where(and(eq(classroomDrafts.id, input.draftId), eq(classroomDrafts.userId, userId)));
        return runs[0];
      });
    },

    async get(userId: string, runId: string) {
      requireUserId(userId);
      const row = await ownedRun(db, userId, runId);
      if (!row) throw new OwnershipError('classroom generation run', runId);
      return row;
    },

    async getCurrent(userId: string) {
      requireUserId(userId);
      const rows = await db.select({
        run: classroomGenerationRuns,
        draft: classroomDrafts,
      }).from(classroomGenerationRuns).innerJoin(classroomDrafts, and(
        eq(classroomDrafts.id, classroomGenerationRuns.draftId),
        eq(classroomDrafts.userId, classroomGenerationRuns.userId),
      )).where(and(
        eq(classroomGenerationRuns.userId, userId),
        eq(classroomDrafts.userId, userId),
        isNull(classroomDrafts.publishedAt),
        ne(classroomGenerationRuns.status, 'aborted'),
      )).orderBy(desc(classroomGenerationRuns.updatedAt)).limit(1);
      return rows[0] ?? null;
    },

    async listOutlineEvents(userId: string, runId: string, afterId = 0) {
      requireUserId(userId);
      const run = await ownedRun(db, userId, runId);
      if (!run || run.run.stage !== 'outline') {
        throw new OwnershipError('classroom outline generation run', runId);
      }
      return db.select().from(classroomOutlineEvents).where(and(
        eq(classroomOutlineEvents.runId, runId),
        eq(classroomOutlineEvents.userId, userId),
        gt(classroomOutlineEvents.id, afterId),
      )).orderBy(asc(classroomOutlineEvents.id));
    },

    async listScenes(userId: string, draftId: string) {
      requireUserId(userId);
      const ownedDrafts = await db.select({ id: classroomDrafts.id }).from(classroomDrafts).where(and(
        eq(classroomDrafts.id, draftId),
        eq(classroomDrafts.userId, userId),
      )).limit(1);
      if (!ownedDrafts[0]) throw new OwnershipError('classroom draft', draftId);
      return db.select().from(classroomDraftScenes).where(and(
        eq(classroomDraftScenes.draftId, draftId),
        eq(classroomDraftScenes.userId, userId),
      )).orderBy(asc(classroomDraftScenes.order));
    },

    async listMediaTasks(userId: string, runId: string) {
      requireUserId(userId);
      const run = await ownedRun(db, userId, runId);
      if (!run) throw new OwnershipError('classroom generation run', runId);
      return db.select().from(classroomDraftMediaTasks).where(and(
        eq(classroomDraftMediaTasks.runId, runId),
        eq(classroomDraftMediaTasks.userId, userId),
      )).orderBy(asc(classroomDraftMediaTasks.taskOrder));
    },

    async startRetry(userId: string, input: {
      runId: string;
      draftId: string;
      promptId: string | null;
      promptRevision: string | null;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const runs = await transaction.update(classroomGenerationRuns).set({
          status: 'queued',
          attempt: sql`${classroomGenerationRuns.attempt} + 1`,
          promptId: input.promptId,
          promptRevision: input.promptRevision,
          modelProviderId: null,
          modelId: null,
          errorCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          cancelRequestedAt: null,
          startedAt: null,
          finishedAt: null,
          updatedAt: new Date(),
        }).where(and(
          eq(classroomGenerationRuns.id, input.runId),
          eq(classroomGenerationRuns.draftId, input.draftId),
          eq(classroomGenerationRuns.userId, userId),
          eq(classroomGenerationRuns.status, 'failed'),
        )).returning();
        if (!runs[0]) return null;
        const drafts = await transaction.update(classroomDrafts).set({
          status: runs[0].stage === 'media_tasks'
            ? 'generating_media'
            : runs[0].stage === 'scene_actions'
            ? 'generating_actions'
            : runs[0].stage === 'scene_content'
              ? 'generating_content'
              : runs[0].stage === 'progressive' ? 'generating_progressive' : 'generating',
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
        )).returning();
        if (!drafts[0]) throw new OwnershipError('classroom draft', input.draftId);
        if (runs[0].stage === 'outline') {
          await transaction.delete(classroomOutlineEvents).where(and(
            eq(classroomOutlineEvents.runId, input.runId),
            eq(classroomOutlineEvents.userId, userId),
          ));
        } else if (runs[0].stage === 'progressive') {
          const failedScenes = await transaction.select({
            id: classroomDraftScenes.id,
            status: classroomDraftScenes.status,
            actionStatus: classroomDraftScenes.actionStatus,
          }).from(classroomDraftScenes).where(and(
            eq(classroomDraftScenes.draftId, input.draftId),
            eq(classroomDraftScenes.userId, userId),
            or(
              eq(classroomDraftScenes.status, 'failed'),
              eq(classroomDraftScenes.actionStatus, 'failed'),
            ),
          ));
          if (failedScenes.length > 0) {
            await transaction.update(classroomDraftScenes).set({
              content: null,
              actions: null,
              status: 'pending',
              actionStatus: 'pending',
              errorCode: null,
              actionErrorCode: null,
              startedAt: null,
              finishedAt: null,
              actionStartedAt: null,
              actionFinishedAt: null,
              updatedAt: new Date(),
            }).where(and(
              eq(classroomDraftScenes.draftId, input.draftId),
              eq(classroomDraftScenes.userId, userId),
              inArray(classroomDraftScenes.id, failedScenes.map((scene) => scene.id)),
            ));
          }
          await transaction.update(classroomDraftMediaTasks).set({
            status: 'pending',
            errorCode: null,
            startedAt: null,
            finishedAt: null,
            updatedAt: new Date(),
          }).where(and(
            eq(classroomDraftMediaTasks.runId, input.runId),
            eq(classroomDraftMediaTasks.userId, userId),
            ne(classroomDraftMediaTasks.status, 'completed'),
          ));
        } else if (runs[0].stage === 'scene_content') {
          await transaction.update(classroomDraftScenes).set({
            status: 'pending',
            errorCode: null,
            startedAt: null,
            finishedAt: null,
            updatedAt: new Date(),
          }).where(and(
            eq(classroomDraftScenes.draftId, input.draftId),
            eq(classroomDraftScenes.userId, userId),
            ne(classroomDraftScenes.status, 'completed'),
          ));
        } else if (runs[0].stage === 'scene_actions') {
          await transaction.update(classroomDraftScenes).set({
            actionStatus: 'pending',
            actionErrorCode: null,
            actionStartedAt: null,
            actionFinishedAt: null,
            updatedAt: new Date(),
          }).where(and(
            eq(classroomDraftScenes.draftId, input.draftId),
            eq(classroomDraftScenes.userId, userId),
            ne(classroomDraftScenes.actionStatus, 'completed'),
          ));
        } else if (runs[0].stage === 'media_tasks') {
          await transaction.update(classroomDraftMediaTasks).set({
            status: 'pending',
            errorCode: null,
            startedAt: null,
            finishedAt: null,
            updatedAt: new Date(),
          }).where(and(
            eq(classroomDraftMediaTasks.runId, input.runId),
            eq(classroomDraftMediaTasks.userId, userId),
            ne(classroomDraftMediaTasks.status, 'completed'),
          ));
        }
        return { draft: drafts[0], run: runs[0] };
      });
    },

    async requestAbort(userId: string, runId: string) {
      requireUserId(userId);
      const now = new Date();
      const queued = await db.transaction(async (transaction) => {
        const runs = await transaction.update(classroomGenerationRuns).set({
          cancelRequestedAt: now,
          status: 'aborted',
          finishedAt: now,
          updatedAt: now,
        }).where(and(
          eq(classroomGenerationRuns.id, runId),
          eq(classroomGenerationRuns.userId, userId),
          eq(classroomGenerationRuns.status, 'queued'),
        )).returning();
        if (!runs[0]) return null;
        await transaction.update(classroomDrafts).set({
          status: runs[0].stage === 'media_tasks'
            ? 'media_aborted'
            : runs[0].stage === 'scene_actions'
            ? 'actions_aborted'
            : runs[0].stage === 'scene_content'
              ? 'content_aborted'
              : runs[0].stage === 'progressive' ? 'progressive_aborted' : 'aborted',
          updatedAt: now,
        }).where(and(
          eq(classroomDrafts.id, runs[0].draftId),
          eq(classroomDrafts.userId, userId),
        ));
        return runs[0];
      });
      if (queued) return queued;
      const running = await db.update(classroomGenerationRuns).set({
        cancelRequestedAt: now,
        updatedAt: now,
      }).where(and(
        eq(classroomGenerationRuns.id, runId),
        eq(classroomGenerationRuns.userId, userId),
        eq(classroomGenerationRuns.status, 'running'),
      )).returning();
      if (running[0]) return running[0];
      const existing = await ownedRun(db, userId, runId);
      if (!existing) throw new OwnershipError('classroom generation run', runId);
      return null;
    },

    // The worker may discover expired work globally, but a claim yields the
    // userId and lease token required by every subsequent business-data query.
    async claimNext(workerId: string, now: Date, leaseExpiresAt: Date) {
      return db.transaction(async (transaction) => {
        const candidates = await transaction.select().from(classroomGenerationRuns).where(or(
          eq(classroomGenerationRuns.status, 'queued'),
          and(
            eq(classroomGenerationRuns.status, 'running'),
            or(isNull(classroomGenerationRuns.leaseExpiresAt), lt(classroomGenerationRuns.leaseExpiresAt, now)),
          ),
        )).orderBy(asc(classroomGenerationRuns.createdAt)).limit(1).for('update', { skipLocked: true });
        const candidate = candidates[0];
        if (!candidate) return null;
        const claimed = await transaction.update(classroomGenerationRuns).set({
          status: 'running',
          leaseOwner: workerId,
          leaseExpiresAt,
          heartbeatAt: now,
          startedAt: candidate.startedAt ?? now,
          updatedAt: now,
        }).where(and(
          eq(classroomGenerationRuns.id, candidate.id),
          eq(classroomGenerationRuns.userId, candidate.userId),
        )).returning();
        return claimed[0] ?? null;
      });
    },

    async getClaimed(userId: string, runId: string, workerId: string) {
      requireUserId(userId);
      const rows = await db.select({
        draft: classroomDrafts,
        run: classroomGenerationRuns,
      }).from(classroomGenerationRuns).innerJoin(classroomDrafts, and(
        eq(classroomDrafts.id, classroomGenerationRuns.draftId),
        eq(classroomDrafts.userId, classroomGenerationRuns.userId),
      )).where(and(
        eq(classroomGenerationRuns.id, runId),
        eq(classroomGenerationRuns.userId, userId),
        eq(classroomGenerationRuns.leaseOwner, workerId),
        eq(classroomGenerationRuns.status, 'running'),
      )).limit(1);
      return rows[0] ?? null;
    },

    async renewLease(userId: string, runId: string, workerId: string, now: Date, leaseExpiresAt: Date) {
      requireUserId(userId);
      const rows = await db.update(classroomGenerationRuns).set({
        heartbeatAt: now,
        leaseExpiresAt,
        updatedAt: now,
      }).where(and(
        eq(classroomGenerationRuns.id, runId),
        eq(classroomGenerationRuns.userId, userId),
        eq(classroomGenerationRuns.leaseOwner, workerId),
        eq(classroomGenerationRuns.status, 'running'),
      )).returning({ cancelRequestedAt: classroomGenerationRuns.cancelRequestedAt });
      return rows[0] ?? null;
    },

    async completeOutline(userId: string, input: {
      runId: string;
      draftId: string;
      workerId: string;
      outline: unknown;
      courseTitle: string;
      eventOrder: number;
      doneEvent: unknown;
      modelProviderId: string;
      modelId: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const now = new Date();
        const runs = await transaction.update(classroomGenerationRuns).set({
          status: 'completed',
          modelProviderId: input.modelProviderId,
          modelId: input.modelId,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          finishedAt: now,
          updatedAt: now,
        }).where(and(
          eq(classroomGenerationRuns.id, input.runId),
          eq(classroomGenerationRuns.draftId, input.draftId),
          eq(classroomGenerationRuns.userId, userId),
          eq(classroomGenerationRuns.leaseOwner, input.workerId),
          eq(classroomGenerationRuns.status, 'running'),
          isNull(classroomGenerationRuns.cancelRequestedAt),
        )).returning();
        if (!runs[0]) return null;
        await transaction.insert(classroomOutlineEvents).values({
          runId: input.runId,
          userId,
          eventOrder: input.eventOrder,
          type: 'done',
          data: input.doneEvent,
        });
        const drafts = await transaction.update(classroomDrafts).set({
          outline: input.outline,
          status: 'outline_ready',
          updatedAt: now,
        }).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
        )).returning();
        if (!drafts[0]) throw new OwnershipError('classroom draft', input.draftId);
        if (drafts[0].classroomId) {
          await transaction.update(classrooms).set({
            title: input.courseTitle,
            updatedAt: now,
          }).where(and(
            eq(classrooms.id, drafts[0].classroomId),
            eq(classrooms.userId, userId),
          ));
        }
        return { draft: drafts[0], run: runs[0] };
      });
    },

    async appendOutlineEvent(userId: string, input: {
      runId: string;
      workerId: string;
      eventOrder: number;
      type: string;
      data: unknown;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({
          id: classroomGenerationRuns.id,
          draftId: classroomGenerationRuns.draftId,
        })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.stage, 'outline'),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
            isNull(classroomGenerationRuns.cancelRequestedAt),
          ))
          .limit(1);
        if (!claims[0]) return null;
        const events = await transaction.insert(classroomOutlineEvents).values({
          runId: input.runId,
          userId,
          eventOrder: input.eventOrder,
          type: input.type,
          data: input.data,
        }).returning();
        const courseTitle = input.type === 'courseTitle'
          && input.data
          && typeof input.data === 'object'
          && !Array.isArray(input.data)
          && typeof (input.data as Record<string, unknown>).data === 'string'
          ? (input.data as Record<string, unknown>).data as string
          : null;
        if (courseTitle) {
          const drafts = await transaction.select({ classroomId: classroomDrafts.classroomId })
            .from(classroomDrafts)
            .where(and(
              eq(classroomDrafts.id, claims[0]!.draftId),
              eq(classroomDrafts.userId, userId),
            ))
            .limit(1);
          if (drafts[0]?.classroomId) {
            await transaction.update(classrooms).set({
              title: courseTitle,
              updatedAt: new Date(),
            }).where(and(
              eq(classrooms.id, drafts[0].classroomId),
              eq(classrooms.userId, userId),
            ));
          }
        }
        return events[0] ?? null;
      });
    },

    async markProgressivePreviewReady(userId: string, input: {
      runId: string;
      draftId: string;
      sceneId: string;
      workerId: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const rows = await transaction.update(classroomDrafts).set({
          status: 'preview_ready',
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
          sql`exists (select 1 from ${classroomGenerationRuns} where ${classroomGenerationRuns.id} = ${input.runId} and ${classroomGenerationRuns.draftId} = ${input.draftId} and ${classroomGenerationRuns.userId} = ${userId} and ${classroomGenerationRuns.stage} = 'progressive' and ${classroomGenerationRuns.status} = 'running' and ${classroomGenerationRuns.leaseOwner} = ${input.workerId})`,
          sql`exists (select 1 from ${classroomDraftScenes} where ${classroomDraftScenes.id} = ${input.sceneId} and ${classroomDraftScenes.draftId} = ${input.draftId} and ${classroomDraftScenes.userId} = ${userId} and ${classroomDraftScenes.order} = 1 and ${classroomDraftScenes.status} = 'completed' and ${classroomDraftScenes.actionStatus} = 'completed')`,
        )).returning();
        return rows[0] ?? null;
      });
    },

    async updateDraftContextForClaim(userId: string, input: {
      runId: string;
      draftId: string;
      workerId: string;
      context: unknown;
    }) {
      requireUserId(userId);
      const rows = await db.update(classroomDrafts).set({
        context: input.context,
        status: 'generating_progressive',
        updatedAt: new Date(),
      }).where(and(
        eq(classroomDrafts.id, input.draftId),
        eq(classroomDrafts.userId, userId),
        sql`exists (select 1 from ${classroomGenerationRuns} where ${classroomGenerationRuns.id} = ${input.runId} and ${classroomGenerationRuns.draftId} = ${input.draftId} and ${classroomGenerationRuns.userId} = ${userId} and ${classroomGenerationRuns.stage} = 'progressive' and ${classroomGenerationRuns.status} = 'running' and ${classroomGenerationRuns.leaseOwner} = ${input.workerId} and ${classroomGenerationRuns.cancelRequestedAt} is null)`,
      )).returning();
      return rows[0] ?? null;
    },

    async completeProgressiveRun(userId: string, input: {
      runId: string;
      draftId: string;
      workerId: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const unfinishedScenes = await transaction.select({ id: classroomDraftScenes.id })
          .from(classroomDraftScenes).where(and(
            eq(classroomDraftScenes.draftId, input.draftId),
            eq(classroomDraftScenes.userId, userId),
            or(
              ne(classroomDraftScenes.status, 'completed'),
              ne(classroomDraftScenes.actionStatus, 'completed'),
            ),
          )).limit(1);
        const unfinishedMedia = await transaction.select({ id: classroomDraftMediaTasks.id })
          .from(classroomDraftMediaTasks).where(and(
            eq(classroomDraftMediaTasks.runId, input.runId),
            eq(classroomDraftMediaTasks.userId, userId),
            ne(classroomDraftMediaTasks.status, 'completed'),
          )).limit(1);
        if (unfinishedScenes[0] || unfinishedMedia[0]) return null;
        const now = new Date();
        const runs = await transaction.update(classroomGenerationRuns).set({
          status: 'completed',
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          finishedAt: now,
          updatedAt: now,
        }).where(and(
          eq(classroomGenerationRuns.id, input.runId),
          eq(classroomGenerationRuns.draftId, input.draftId),
          eq(classroomGenerationRuns.userId, userId),
          eq(classroomGenerationRuns.stage, 'progressive'),
          eq(classroomGenerationRuns.status, 'running'),
          eq(classroomGenerationRuns.leaseOwner, input.workerId),
          isNull(classroomGenerationRuns.cancelRequestedAt),
        )).returning();
        if (!runs[0]) return null;
        const drafts = await transaction.update(classroomDrafts).set({
          status: 'media_ready',
          updatedAt: now,
        }).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
        )).returning();
        return drafts[0] ? { draft: drafts[0], run: runs[0] } : null;
      });
    },

    async startScene(userId: string, input: {
      runId: string;
      draftId: string;
      sceneId: string;
      workerId: string;
      promptId: string | null;
      promptRevision: string | null;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            or(
              eq(classroomGenerationRuns.stage, 'scene_content'),
              eq(classroomGenerationRuns.stage, 'progressive'),
            ),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
            isNull(classroomGenerationRuns.cancelRequestedAt),
          ))
          .limit(1)
          .for('update');
        if (!claims[0]) return null;
        const scenes = await transaction.update(classroomDraftScenes).set({
          status: 'running',
          attempt: sql`${classroomDraftScenes.attempt} + 1`,
          promptId: input.promptId,
          promptRevision: input.promptRevision,
          modelProviderId: null,
          modelId: null,
          errorCode: null,
          startedAt: new Date(),
          finishedAt: null,
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDraftScenes.id, input.sceneId),
          eq(classroomDraftScenes.draftId, input.draftId),
          eq(classroomDraftScenes.userId, userId),
          ne(classroomDraftScenes.status, 'completed'),
        )).returning();
        return scenes[0] ?? null;
      });
    },

    async completeScene(userId: string, input: {
      runId: string;
      draftId: string;
      sceneId: string;
      workerId: string;
      content: unknown;
      modelProviderId: string;
      modelId: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
            isNull(classroomGenerationRuns.cancelRequestedAt),
          ))
          .limit(1)
          .for('update');
        if (!claims[0]) return null;
        const scenes = await transaction.update(classroomDraftScenes).set({
          content: input.content,
          status: 'completed',
          modelProviderId: input.modelProviderId,
          modelId: input.modelId,
          errorCode: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDraftScenes.id, input.sceneId),
          eq(classroomDraftScenes.draftId, input.draftId),
          eq(classroomDraftScenes.userId, userId),
          eq(classroomDraftScenes.status, 'running'),
        )).returning();
        return scenes[0] ?? null;
      });
    },

    async failScene(userId: string, input: {
      runId: string;
      draftId: string;
      sceneId: string;
      workerId: string;
      errorCode: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
          ))
          .limit(1)
          .for('update');
        if (!claims[0]) return null;
        const scenes = await transaction.update(classroomDraftScenes).set({
          status: 'failed',
          errorCode: input.errorCode,
          finishedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDraftScenes.id, input.sceneId),
          eq(classroomDraftScenes.draftId, input.draftId),
          eq(classroomDraftScenes.userId, userId),
          eq(classroomDraftScenes.status, 'running'),
        )).returning();
        return scenes[0] ?? null;
      });
    },

    async completeSceneContentRun(userId: string, input: { runId: string; draftId: string; workerId: string }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.stage, 'scene_content'),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
            isNull(classroomGenerationRuns.cancelRequestedAt),
          ))
          .limit(1)
          .for('update');
        if (!claims[0]) return null;
        const unfinished = await transaction.select({ id: classroomDraftScenes.id })
          .from(classroomDraftScenes)
          .where(and(
            eq(classroomDraftScenes.draftId, input.draftId),
            eq(classroomDraftScenes.userId, userId),
            ne(classroomDraftScenes.status, 'completed'),
          ))
          .limit(1);
        if (unfinished[0]) return null;
        const now = new Date();
        const runs = await transaction.update(classroomGenerationRuns).set({
          status: 'completed',
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          finishedAt: now,
          updatedAt: now,
        }).where(and(
          eq(classroomGenerationRuns.id, input.runId),
          eq(classroomGenerationRuns.userId, userId),
          eq(classroomGenerationRuns.leaseOwner, input.workerId),
        )).returning();
        if (!runs[0]) return null;
        const drafts = await transaction.update(classroomDrafts).set({
          status: 'content_ready',
          updatedAt: now,
        }).where(and(eq(classroomDrafts.id, input.draftId), eq(classroomDrafts.userId, userId))).returning();
        return drafts[0] ? { draft: drafts[0], run: runs[0] } : null;
      });
    },

    async startSceneActions(userId: string, input: {
      runId: string;
      draftId: string;
      sceneId: string;
      workerId: string;
      promptId: string;
      promptRevision: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            or(
              eq(classroomGenerationRuns.stage, 'scene_actions'),
              eq(classroomGenerationRuns.stage, 'progressive'),
            ),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
            isNull(classroomGenerationRuns.cancelRequestedAt),
          ))
          .limit(1)
          .for('update');
        if (!claims[0]) return null;
        const scenes = await transaction.update(classroomDraftScenes).set({
          actionStatus: 'running',
          actionAttempt: sql`${classroomDraftScenes.actionAttempt} + 1`,
          actionPromptId: input.promptId,
          actionPromptRevision: input.promptRevision,
          actionModelProviderId: null,
          actionModelId: null,
          actionErrorCode: null,
          actionStartedAt: new Date(),
          actionFinishedAt: null,
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDraftScenes.id, input.sceneId),
          eq(classroomDraftScenes.draftId, input.draftId),
          eq(classroomDraftScenes.userId, userId),
          eq(classroomDraftScenes.status, 'completed'),
          ne(classroomDraftScenes.actionStatus, 'completed'),
        )).returning();
        return scenes[0] ?? null;
      });
    },

    async completeSceneActions(userId: string, input: {
      runId: string;
      draftId: string;
      sceneId: string;
      workerId: string;
      actions: unknown;
      modelProviderId: string;
      modelId: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            or(
              eq(classroomGenerationRuns.stage, 'scene_actions'),
              eq(classroomGenerationRuns.stage, 'progressive'),
            ),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
            isNull(classroomGenerationRuns.cancelRequestedAt),
          ))
          .limit(1)
          .for('update');
        if (!claims[0]) return null;
        const scenes = await transaction.update(classroomDraftScenes).set({
          actions: input.actions,
          actionStatus: 'completed',
          actionModelProviderId: input.modelProviderId,
          actionModelId: input.modelId,
          actionErrorCode: null,
          actionFinishedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDraftScenes.id, input.sceneId),
          eq(classroomDraftScenes.draftId, input.draftId),
          eq(classroomDraftScenes.userId, userId),
          eq(classroomDraftScenes.actionStatus, 'running'),
        )).returning();
        return scenes[0] ?? null;
      });
    },

    async failSceneActions(userId: string, input: {
      runId: string;
      draftId: string;
      sceneId: string;
      workerId: string;
      errorCode: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            or(
              eq(classroomGenerationRuns.stage, 'scene_actions'),
              eq(classroomGenerationRuns.stage, 'progressive'),
            ),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
          ))
          .limit(1)
          .for('update');
        if (!claims[0]) return null;
        const scenes = await transaction.update(classroomDraftScenes).set({
          actionStatus: 'failed',
          actionErrorCode: input.errorCode,
          actionFinishedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDraftScenes.id, input.sceneId),
          eq(classroomDraftScenes.draftId, input.draftId),
          eq(classroomDraftScenes.userId, userId),
          eq(classroomDraftScenes.actionStatus, 'running'),
        )).returning();
        return scenes[0] ?? null;
      });
    },

    async completeSceneActionsRun(userId: string, input: { runId: string; draftId: string; workerId: string }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            eq(classroomGenerationRuns.stage, 'scene_actions'),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
            isNull(classroomGenerationRuns.cancelRequestedAt),
          ))
          .limit(1)
          .for('update');
        if (!claims[0]) return null;
        const unfinished = await transaction.select({ id: classroomDraftScenes.id })
          .from(classroomDraftScenes)
          .where(and(
            eq(classroomDraftScenes.draftId, input.draftId),
            eq(classroomDraftScenes.userId, userId),
            ne(classroomDraftScenes.actionStatus, 'completed'),
          ))
          .limit(1);
        if (unfinished[0]) return null;
        const now = new Date();
        const runs = await transaction.update(classroomGenerationRuns).set({
          status: 'completed',
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          finishedAt: now,
          updatedAt: now,
        }).where(and(
          eq(classroomGenerationRuns.id, input.runId),
          eq(classroomGenerationRuns.userId, userId),
          eq(classroomGenerationRuns.leaseOwner, input.workerId),
        )).returning();
        if (!runs[0]) return null;
        const drafts = await transaction.update(classroomDrafts).set({
          status: 'actions_ready',
          updatedAt: now,
        }).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
        )).returning();
        return drafts[0] ? { draft: drafts[0], run: runs[0] } : null;
      });
    },

    async startMediaTask(userId: string, input: {
      runId: string;
      draftId: string;
      taskId: string;
      workerId: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            or(
              eq(classroomGenerationRuns.stage, 'media_tasks'),
              eq(classroomGenerationRuns.stage, 'progressive'),
            ),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
            isNull(classroomGenerationRuns.cancelRequestedAt),
          )).limit(1).for('update');
        if (!claims[0]) return null;
        const tasks = await transaction.update(classroomDraftMediaTasks).set({
          status: 'running',
          attempt: sql`${classroomDraftMediaTasks.attempt} + 1`,
          errorCode: null,
          startedAt: new Date(),
          finishedAt: null,
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDraftMediaTasks.id, input.taskId),
          eq(classroomDraftMediaTasks.runId, input.runId),
          eq(classroomDraftMediaTasks.draftId, input.draftId),
          eq(classroomDraftMediaTasks.userId, userId),
          ne(classroomDraftMediaTasks.status, 'completed'),
        )).returning();
        return tasks[0] ?? null;
      });
    },

    async saveMediaTaskProviderTask(userId: string, input: {
      runId: string;
      draftId: string;
      taskId: string;
      workerId: string;
      providerId: string;
      modelId: string;
      providerTaskId: string;
    }) {
      requireUserId(userId);
      const tasks = await db.update(classroomDraftMediaTasks).set({
        providerId: input.providerId,
        modelId: input.modelId,
        providerTaskId: input.providerTaskId,
        updatedAt: new Date(),
      }).where(and(
        eq(classroomDraftMediaTasks.id, input.taskId),
        eq(classroomDraftMediaTasks.runId, input.runId),
        eq(classroomDraftMediaTasks.draftId, input.draftId),
        eq(classroomDraftMediaTasks.userId, userId),
        eq(classroomDraftMediaTasks.status, 'running'),
        sql`exists (select 1 from ${classroomGenerationRuns} where ${classroomGenerationRuns.id} = ${input.runId} and ${classroomGenerationRuns.userId} = ${userId} and ${classroomGenerationRuns.leaseOwner} = ${input.workerId} and ${classroomGenerationRuns.status} = 'running')`,
      )).returning();
      return tasks[0] ?? null;
    },

    async completeMediaTask(userId: string, input: {
      runId: string;
      draftId: string;
      taskId: string;
      sceneId: string;
      actionId: string | null;
      elementId: string | null;
      kind: 'audio' | 'image' | 'video';
      workerId: string;
      providerId: string;
      modelId: string;
      mediaRef: string;
      objectKey: string;
      contentType: string;
      size: number;
      contentHash: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const claims = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            or(
              eq(classroomGenerationRuns.stage, 'media_tasks'),
              eq(classroomGenerationRuns.stage, 'progressive'),
            ),
            eq(classroomGenerationRuns.status, 'running'),
            eq(classroomGenerationRuns.leaseOwner, input.workerId),
            isNull(classroomGenerationRuns.cancelRequestedAt),
          )).limit(1).for('update');
        if (!claims[0]) return null;
        const scenes = await transaction.select({
          actions: classroomDraftScenes.actions,
          content: classroomDraftScenes.content,
        })
          .from(classroomDraftScenes).where(and(
            eq(classroomDraftScenes.id, input.sceneId),
            eq(classroomDraftScenes.draftId, input.draftId),
            eq(classroomDraftScenes.userId, userId),
          )).limit(1).for('update');
        if (!scenes[0]) throw new OwnershipError('classroom draft scene', input.sceneId);
        const actions = input.kind === 'audio'
          ? attachAudioRef(scenes[0].actions, requiredTaskSource(input.actionId, 'audio action'), input.mediaRef)
          : scenes[0].actions;
        const content = input.kind === 'image' || input.kind === 'video'
          ? attachMediaRef(scenes[0].content, requiredTaskSource(input.elementId, 'media element'), input.mediaRef, input.kind)
          : scenes[0].content;
        const tasks = await transaction.update(classroomDraftMediaTasks).set({
          status: 'completed',
          providerId: input.providerId,
          modelId: input.modelId,
          mediaRef: input.mediaRef,
          objectKey: input.objectKey,
          contentType: input.contentType,
          size: input.size,
          contentHash: input.contentHash,
          errorCode: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(classroomDraftMediaTasks.id, input.taskId),
          eq(classroomDraftMediaTasks.runId, input.runId),
          eq(classroomDraftMediaTasks.userId, userId),
          eq(classroomDraftMediaTasks.status, 'running'),
        )).returning();
        if (!tasks[0]) return null;
        await transaction.update(classroomDraftScenes).set({ actions, content, updatedAt: new Date() }).where(and(
          eq(classroomDraftScenes.id, input.sceneId),
          eq(classroomDraftScenes.userId, userId),
        ));
        return tasks[0];
      });
    },

    async failMediaTask(userId: string, input: {
      runId: string;
      taskId: string;
      workerId: string;
      errorCode: string;
    }) {
      requireUserId(userId);
      const tasks = await db.update(classroomDraftMediaTasks).set({
        status: 'failed',
        errorCode: input.errorCode,
        finishedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(classroomDraftMediaTasks.id, input.taskId),
        eq(classroomDraftMediaTasks.runId, input.runId),
        eq(classroomDraftMediaTasks.userId, userId),
        eq(classroomDraftMediaTasks.status, 'running'),
        sql`exists (select 1 from ${classroomGenerationRuns} where ${classroomGenerationRuns.id} = ${input.runId} and ${classroomGenerationRuns.userId} = ${userId} and ${classroomGenerationRuns.leaseOwner} = ${input.workerId})`,
      )).returning();
      return tasks[0] ?? null;
    },

    async completeMediaTasksRun(userId: string, input: { runId: string; draftId: string; workerId: string }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const unfinished = await transaction.select({ id: classroomDraftMediaTasks.id })
          .from(classroomDraftMediaTasks).where(and(
            eq(classroomDraftMediaTasks.runId, input.runId),
            eq(classroomDraftMediaTasks.userId, userId),
            ne(classroomDraftMediaTasks.status, 'completed'),
          )).limit(1);
        if (unfinished[0]) return null;
        const now = new Date();
        const runs = await transaction.update(classroomGenerationRuns).set({
          status: 'completed', leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null,
          finishedAt: now, updatedAt: now,
        }).where(and(
          eq(classroomGenerationRuns.id, input.runId),
          eq(classroomGenerationRuns.draftId, input.draftId),
          eq(classroomGenerationRuns.userId, userId),
          eq(classroomGenerationRuns.stage, 'media_tasks'),
          eq(classroomGenerationRuns.status, 'running'),
          eq(classroomGenerationRuns.leaseOwner, input.workerId),
          isNull(classroomGenerationRuns.cancelRequestedAt),
        )).returning();
        if (!runs[0]) return null;
        const drafts = await transaction.update(classroomDrafts).set({ status: 'media_ready', updatedAt: now })
          .where(and(eq(classroomDrafts.id, input.draftId), eq(classroomDrafts.userId, userId))).returning();
        return drafts[0] ? { draft: drafts[0], run: runs[0] } : null;
      });
    },

    async getPublishedClassroom(userId: string, draftId: string) {
      requireUserId(userId);
      const rows = await db.select({ classroom: classrooms, artifact: classroomArtifacts })
        .from(classroomDrafts)
        .innerJoin(classrooms, and(
          eq(classrooms.id, classroomDrafts.classroomId),
          eq(classrooms.userId, classroomDrafts.userId),
        ))
        .innerJoin(classroomArtifacts, and(
          eq(classroomArtifacts.id, classroomDrafts.artifactId),
          eq(classroomArtifacts.classroomId, classroomDrafts.classroomId),
          eq(classroomArtifacts.userId, classroomDrafts.userId),
        ))
        .where(and(eq(classroomDrafts.id, draftId), eq(classroomDrafts.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async reserveDraftPublication(userId: string, input: {
      runId: string;
      draftId: string;
      publicationToken: string;
      staleBefore: Date;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const draftRows = await transaction.select().from(classroomDrafts).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
        )).limit(1).for('update');
        const draft = draftRows[0];
        if (!draft) throw new OwnershipError('classroom draft', input.draftId);
        if (draft.classroomId && draft.artifactId) return { state: 'published' as const };

        const sourceRuns = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            or(
              eq(classroomGenerationRuns.stage, 'media_tasks'),
              eq(classroomGenerationRuns.stage, 'progressive'),
            ),
            eq(classroomGenerationRuns.status, 'completed'),
          ))
          .limit(1);
        if (!sourceRuns[0] || !['media_ready', 'publishing'].includes(draft.status)) {
          throw new OwnershipError('publishable classroom generation run', input.runId);
        }
        if (
          draft.status === 'publishing'
          && draft.publicationToken
          && draft.publicationStartedAt
          && draft.publicationStartedAt > input.staleBefore
        ) return { state: 'busy' as const };

        const token = draft.publicationToken ?? input.publicationToken;
        const now = new Date();
        const rows = await transaction.update(classroomDrafts).set({
          status: 'publishing',
          publicationToken: token,
          publicationStartedAt: now,
          updatedAt: now,
        }).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
          sql`${classroomDrafts.classroomId} is not null`,
          isNull(classroomDrafts.artifactId),
        )).returning();
        return rows[0] ? { state: 'reserved' as const, publicationToken: token } : { state: 'busy' as const };
      });
    },

    async releaseDraftPublication(userId: string, input: { draftId: string; publicationToken: string }) {
      requireUserId(userId);
      const rows = await db.update(classroomDrafts).set({
        status: 'media_ready',
        updatedAt: new Date(),
      }).where(and(
        eq(classroomDrafts.id, input.draftId),
        eq(classroomDrafts.userId, userId),
        eq(classroomDrafts.status, 'publishing'),
        eq(classroomDrafts.publicationToken, input.publicationToken),
        sql`${classroomDrafts.classroomId} is not null`,
        isNull(classroomDrafts.artifactId),
      )).returning();
      return rows[0] ?? null;
    },

    async publishDraft(userId: string, input: {
      runId: string;
      draftId: string;
      classroomId: string;
      artifactId: string;
      title: string;
      description: string;
      document: unknown;
      contentHash: string;
      publicationToken: string;
      media: Array<{
        id: string;
        path: string;
        objectKey: string;
        contentType: string;
        size: number;
        contentHash: string;
      }>;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const draftRows = await transaction.select().from(classroomDrafts).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
        )).limit(1).for('update');
        const draft = draftRows[0];
        if (!draft) throw new OwnershipError('classroom draft', input.draftId);

        if (draft.classroomId && draft.artifactId) {
          const existing = await transaction.select({ classroom: classrooms, artifact: classroomArtifacts })
            .from(classrooms)
            .innerJoin(classroomArtifacts, and(
              eq(classroomArtifacts.id, draft.artifactId),
              eq(classroomArtifacts.classroomId, classrooms.id),
              eq(classroomArtifacts.userId, classrooms.userId),
            ))
            .where(and(
              eq(classrooms.id, draft.classroomId),
              eq(classrooms.userId, userId),
            ))
            .limit(1);
          if (!existing[0]) throw new OwnershipError('published classroom', draft.classroomId);
          return { ...existing[0], created: false as const };
        }

        const sourceRuns = await transaction.select({ id: classroomGenerationRuns.id })
          .from(classroomGenerationRuns)
          .where(and(
            eq(classroomGenerationRuns.id, input.runId),
            eq(classroomGenerationRuns.draftId, input.draftId),
            eq(classroomGenerationRuns.userId, userId),
            or(
              eq(classroomGenerationRuns.stage, 'media_tasks'),
              eq(classroomGenerationRuns.stage, 'progressive'),
            ),
            eq(classroomGenerationRuns.status, 'completed'),
          ))
          .limit(1);
        if (
          !sourceRuns[0]
          || draft.status !== 'publishing'
          || draft.publicationToken !== input.publicationToken
        ) {
          throw new OwnershipError('publishable classroom generation run', input.runId);
        }
        const incompleteScenes = await transaction.select({ id: classroomDraftScenes.id })
          .from(classroomDraftScenes)
          .where(and(
            eq(classroomDraftScenes.draftId, input.draftId),
            eq(classroomDraftScenes.userId, userId),
            or(
              ne(classroomDraftScenes.status, 'completed'),
              ne(classroomDraftScenes.actionStatus, 'completed'),
              isNull(classroomDraftScenes.content),
              isNull(classroomDraftScenes.actions),
            ),
          ))
          .limit(1);
        const incompleteMedia = await transaction.select({ id: classroomDraftMediaTasks.id })
          .from(classroomDraftMediaTasks)
          .where(and(
            eq(classroomDraftMediaTasks.runId, input.runId),
            eq(classroomDraftMediaTasks.draftId, input.draftId),
            eq(classroomDraftMediaTasks.userId, userId),
            ne(classroomDraftMediaTasks.status, 'completed'),
          ))
          .limit(1);
        if (incompleteScenes[0] || incompleteMedia[0]) {
          throw new OwnershipError('completed classroom draft', input.draftId);
        }

        if (draft.classroomId !== input.classroomId) {
          throw new OwnershipError('classroom draft identity', input.classroomId);
        }
        const classroomRows = await transaction.update(classrooms).set({
          title: input.title,
          description: input.description,
          updatedAt: new Date(),
        }).where(and(
          eq(classrooms.id, input.classroomId),
          eq(classrooms.userId, userId),
        )).returning();
        if (!classroomRows[0]) throw new OwnershipError('classroom', input.classroomId);
        const artifactRows = await transaction.insert(classroomArtifacts).values({
          id: input.artifactId,
          classroomId: input.classroomId,
          userId,
          version: 1,
          document: input.document,
          contentHash: input.contentHash,
        }).returning();
        if (input.media.length > 0) {
          await transaction.insert(classroomArtifactMedia).values(input.media.map((media) => ({
            ...media,
            artifactId: input.artifactId,
            classroomId: input.classroomId,
            userId,
          })));
        }
        const now = new Date();
        const published = await transaction.update(classroomDrafts).set({
          status: 'published',
          classroomId: input.classroomId,
          artifactId: input.artifactId,
          publishedAt: now,
          publicationToken: null,
          publicationStartedAt: null,
          updatedAt: now,
        }).where(and(
          eq(classroomDrafts.id, input.draftId),
          eq(classroomDrafts.userId, userId),
          eq(classroomDrafts.status, 'publishing'),
          eq(classroomDrafts.publicationToken, input.publicationToken),
          eq(classroomDrafts.classroomId, input.classroomId),
          isNull(classroomDrafts.artifactId),
        )).returning({ id: classroomDrafts.id });
        if (!published[0]) throw new OwnershipError('unpublished classroom draft', input.draftId);
        return { classroom: classroomRows[0]!, artifact: artifactRows[0]!, created: true as const };
      });
    },

    async failClaimed(userId: string, input: {
      runId: string;
      draftId: string;
      workerId: string;
      errorCode: string;
    }) {
      requireUserId(userId);
      return finishClaim(db, userId, input, 'failed');
    },

    async abortClaimed(userId: string, input: { runId: string; draftId: string; workerId: string }) {
      requireUserId(userId);
      return finishClaim(db, userId, { ...input, errorCode: null }, 'aborted');
    },

    async releaseClaim(userId: string, runId: string, workerId: string) {
      requireUserId(userId);
      const rows = await db.update(classroomGenerationRuns).set({
        status: 'queued',
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(classroomGenerationRuns.id, runId),
        eq(classroomGenerationRuns.userId, userId),
        eq(classroomGenerationRuns.leaseOwner, workerId),
        eq(classroomGenerationRuns.status, 'running'),
        isNull(classroomGenerationRuns.cancelRequestedAt),
      )).returning();
      return rows[0] ?? null;
    },
  };
}

function attachAudioRef(value: unknown, actionId: string, mediaRef: string) {
  if (!Array.isArray(value)) throw new Error('Scene actions are not an array');
  let found = false;
  const actions = value.map((action) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return action;
    const record = action as Record<string, unknown>;
    if (record.id !== actionId || record.type !== 'speech') return action;
    found = true;
    return { ...record, audioRef: mediaRef };
  });
  if (!found) throw new Error(`Speech action ${actionId} no longer exists`);
  return actions;
}

function attachMediaRef(value: unknown, elementId: string, mediaRef: string, kind: 'image' | 'video') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scene content is not an object');
  const content = value as Record<string, unknown>;
  const canvas = content.canvas;
  if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas)) throw new Error('Scene canvas is not an object');
  const canvasRecord = canvas as Record<string, unknown>;
  if (!Array.isArray(canvasRecord.elements)) throw new Error('Scene canvas elements are not an array');
  let found = false;
  const elements = canvasRecord.elements.map((element) => {
    if (!element || typeof element !== 'object' || Array.isArray(element)) return element;
    const record = element as Record<string, unknown>;
    const key = kind === 'image' ? 'src' : 'mediaRef';
    if (record[key] !== elementId) return element;
    found = true;
    return { ...record, [key]: mediaRef };
  });
  if (!found) throw new Error(`Generated media element ${elementId} no longer exists`);
  return { ...content, canvas: { ...canvasRecord, elements } };
}

function requiredTaskSource(value: string | null, label: string) {
  if (!value) throw new Error(`Media task is missing its ${label}`);
  return value;
}

async function ownedRun(db: Database, userId: string, runId: string) {
  const rows = await db.select({
    draft: classroomDrafts,
    run: classroomGenerationRuns,
  }).from(classroomGenerationRuns).innerJoin(classroomDrafts, and(
    eq(classroomDrafts.id, classroomGenerationRuns.draftId),
    eq(classroomDrafts.userId, classroomGenerationRuns.userId),
  )).where(and(
    eq(classroomGenerationRuns.id, runId),
    eq(classroomGenerationRuns.userId, userId),
    eq(classroomDrafts.userId, userId),
  )).limit(1);
  return rows[0] ?? null;
}

async function finishClaim(
  db: Database,
  userId: string,
  input: { runId: string; draftId: string; workerId: string; errorCode: string | null },
  status: 'failed' | 'aborted',
) {
  return db.transaction(async (transaction) => {
    const now = new Date();
    const guards = [
      eq(classroomGenerationRuns.id, input.runId),
      eq(classroomGenerationRuns.draftId, input.draftId),
      eq(classroomGenerationRuns.userId, userId),
      eq(classroomGenerationRuns.leaseOwner, input.workerId),
      eq(classroomGenerationRuns.status, 'running'),
      ...(status === 'failed' ? [isNull(classroomGenerationRuns.cancelRequestedAt)] : []),
    ];
    const runs = await transaction.update(classroomGenerationRuns).set({
      status,
      errorCode: input.errorCode,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      finishedAt: now,
      updatedAt: now,
    }).where(and(...guards)).returning();
    if (!runs[0]) return null;
    const drafts = await transaction.update(classroomDrafts).set({
      status: runs[0].stage === 'media_tasks'
        ? (status === 'failed' ? 'media_failed' : 'media_aborted')
        : runs[0].stage === 'scene_actions'
        ? (status === 'failed' ? 'actions_failed' : 'actions_aborted')
        : runs[0].stage === 'scene_content'
          ? (status === 'failed' ? 'content_failed' : 'content_aborted')
          : runs[0].stage === 'progressive'
            ? (status === 'failed' ? 'progressive_failed' : 'progressive_aborted')
          : status,
      updatedAt: now,
    }).where(and(
      eq(classroomDrafts.id, input.draftId),
      eq(classroomDrafts.userId, userId),
    )).returning();
    if (!drafts[0]) throw new OwnershipError('classroom draft', input.draftId);
    return { draft: drafts[0], run: runs[0] };
  });
}
