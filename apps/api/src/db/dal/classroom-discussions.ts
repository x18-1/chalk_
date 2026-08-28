import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import {
  classroomArtifacts,
  classroomDiscussionMessages,
  classroomDiscussionRounds,
  classroomDiscussionSessions,
  classroomDrafts,
  classroomDraftScenes,
  classroomGenerationRuns,
  classroomLearningSessions,
} from '../schema';

export type DiscussionTarget =
  | { kind: 'learning_session'; id: string }
  | { kind: 'generation_run'; id: string };

function requireUserId(userId: string) {
  if (!userId) throw new AuthRequiredError();
}

function targetCondition(userId: string, target: DiscussionTarget, sceneId: string) {
  return target.kind === 'learning_session'
    ? and(
        eq(classroomDiscussionSessions.userId, userId),
        eq(classroomDiscussionSessions.learningSessionId, target.id),
        eq(classroomDiscussionSessions.sceneId, sceneId),
      )
    : and(
        eq(classroomDiscussionSessions.userId, userId),
        eq(classroomDiscussionSessions.generationRunId, target.id),
        eq(classroomDiscussionSessions.sceneId, sceneId),
      );
}

export function createClassroomDiscussionsDal(db: Database) {
  return {
    async resolveTarget(userId: string, target: DiscussionTarget, sceneId: string) {
      requireUserId(userId);
      if (target.kind === 'learning_session') {
        const rows = await db
          .select({ session: classroomLearningSessions, document: classroomArtifacts.document })
          .from(classroomLearningSessions)
          .innerJoin(classroomArtifacts, and(
            eq(classroomArtifacts.id, classroomLearningSessions.artifactId),
            eq(classroomArtifacts.classroomId, classroomLearningSessions.classroomId),
            eq(classroomArtifacts.userId, classroomLearningSessions.userId),
          ))
          .where(and(
            eq(classroomLearningSessions.id, target.id),
            eq(classroomLearningSessions.userId, userId),
            eq(classroomArtifacts.userId, userId),
          ))
          .limit(1);
        const row = rows[0];
        if (!row) throw new OwnershipError('learning session', target.id);
        return {
          target,
          sceneId,
          document: row.document,
          entryCursor: {
            version: row.session.cursorVersion,
            stageId: row.session.stageId,
            sceneId: row.session.sceneId,
            sceneIndex: row.session.sceneIndex,
            actionIndex: row.session.actionIndex,
            mode: row.session.mode,
            completed: row.session.completed,
          },
        };
      }

      const rows = await db
        .select({
          run: classroomGenerationRuns,
          draft: classroomDrafts,
          scene: classroomDraftScenes,
        })
        .from(classroomGenerationRuns)
        .innerJoin(classroomDrafts, and(
          eq(classroomDrafts.id, classroomGenerationRuns.draftId),
          eq(classroomDrafts.userId, classroomGenerationRuns.userId),
        ))
        .innerJoin(classroomDraftScenes, and(
          eq(classroomDraftScenes.draftId, classroomGenerationRuns.draftId),
          eq(classroomDraftScenes.userId, classroomGenerationRuns.userId),
          eq(classroomDraftScenes.outlineId, sceneId),
        ))
        .where(and(
          eq(classroomGenerationRuns.id, target.id),
          eq(classroomGenerationRuns.userId, userId),
          eq(classroomDraftScenes.status, 'completed'),
          eq(classroomDraftScenes.actionStatus, 'completed'),
        ))
        .limit(1);
      const row = rows[0];
      if (!row) throw new OwnershipError('classroom generation run', target.id);
      return {
        target,
        sceneId,
        document: {
          stage: {
            id: row.draft.id,
            name: typeof row.draft.outline === 'object' && row.draft.outline !== null &&
              'courseTitle' in row.draft.outline && typeof row.draft.outline.courseTitle === 'string'
              ? row.draft.outline.courseTitle
              : 'Draft Classroom',
            ...(typeof row.draft.context === 'object' && row.draft.context !== null &&
              'agentProfiles' in row.draft.context && Array.isArray(row.draft.context.agentProfiles)
              ? { agentProfiles: row.draft.context.agentProfiles }
              : {}),
          },
          scenes: [{
            id: row.scene.outlineId,
            type: row.scene.type,
            title: typeof row.scene.outline === 'object' && row.scene.outline !== null &&
              'title' in row.scene.outline && typeof row.scene.outline.title === 'string'
              ? row.scene.outline.title
              : row.scene.outlineId,
            content: row.scene.content,
            actions: row.scene.actions,
          }],
        },
        draftId: row.draft.id,
      };
    },

    async createOrResume(userId: string, input: {
      target: DiscussionTarget;
      sceneId: string;
      topic: string;
      prompt?: string;
      triggerAgentId?: string;
      participants: unknown;
      entryCursor: unknown;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.target.kind}:${input.target.id}:${input.sceneId}`}))`);
        const existing = await transaction
          .select()
          .from(classroomDiscussionSessions)
          .where(and(
            targetCondition(userId, input.target, input.sceneId),
            eq(classroomDiscussionSessions.status, 'active'),
          ))
          .orderBy(desc(classroomDiscussionSessions.updatedAt))
          .limit(1);
        if (existing[0]) return { row: existing[0], created: false };

        const rows = await transaction
          .insert(classroomDiscussionSessions)
          .values({
            userId,
            ...(input.target.kind === 'learning_session'
              ? { learningSessionId: input.target.id }
              : { generationRunId: input.target.id }),
            sceneId: input.sceneId,
            topic: input.topic,
            prompt: input.prompt,
            triggerAgentId: input.triggerAgentId,
            participants: input.participants,
            entryCursor: input.entryCursor,
          })
          .returning();
        return { row: rows[0]!, created: true };
      });
    },

    async findCurrent(userId: string, target: DiscussionTarget, sceneId: string) {
      requireUserId(userId);
      const rows = await db
        .select()
        .from(classroomDiscussionSessions)
        .where(and(
          targetCondition(userId, target, sceneId),
          eq(classroomDiscussionSessions.status, 'active'),
        ))
        .orderBy(desc(classroomDiscussionSessions.updatedAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async get(userId: string, discussionId: string) {
      requireUserId(userId);
      const sessions = await db
        .select()
        .from(classroomDiscussionSessions)
        .where(and(
          eq(classroomDiscussionSessions.id, discussionId),
          eq(classroomDiscussionSessions.userId, userId),
        ))
        .limit(1);
      if (!sessions[0]) throw new OwnershipError('classroom discussion', discussionId);
      const messages = await db
        .select()
        .from(classroomDiscussionMessages)
        .where(and(
          eq(classroomDiscussionMessages.discussionId, discussionId),
          eq(classroomDiscussionMessages.userId, userId),
        ))
        .orderBy(asc(classroomDiscussionMessages.sequence));
      return { session: sessions[0], messages };
    },

    async startRound(userId: string, discussionId: string, runnerId: string, message?: string) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${discussionId}))`);
        const sessions = await transaction
          .select()
          .from(classroomDiscussionSessions)
          .where(and(
            eq(classroomDiscussionSessions.id, discussionId),
            eq(classroomDiscussionSessions.userId, userId),
            eq(classroomDiscussionSessions.status, 'active'),
          ))
          .limit(1);
        if (!sessions[0]) throw new OwnershipError('active classroom discussion', discussionId);
        const running = await transaction
          .select({ id: classroomDiscussionRounds.id })
          .from(classroomDiscussionRounds)
          .where(and(
            eq(classroomDiscussionRounds.discussionId, discussionId),
            eq(classroomDiscussionRounds.userId, userId),
            eq(classroomDiscussionRounds.status, 'running'),
          ))
          .limit(1);
        if (running[0]) return { conflict: true as const, session: sessions[0] };

        const [round] = await transaction
          .insert(classroomDiscussionRounds)
          .values({ discussionId, userId, leaseOwner: runnerId, heartbeatAt: new Date() })
          .returning();
        let studentMessage: typeof classroomDiscussionMessages.$inferSelect | undefined;
        if (message) {
          const sequences = await transaction
            .select({ next: sql<number>`coalesce(max(${classroomDiscussionMessages.sequence}), 0) + 1` })
            .from(classroomDiscussionMessages)
            .where(and(
              eq(classroomDiscussionMessages.discussionId, discussionId),
              eq(classroomDiscussionMessages.userId, userId),
            ));
          [studentMessage] = await transaction
            .insert(classroomDiscussionMessages)
            .values({
              discussionId,
              roundId: round!.id,
              userId,
              sequence: Number(sequences[0]?.next ?? 1),
              sender: 'student',
              content: message,
              status: 'completed',
            })
            .returning();
        }
        return { conflict: false as const, session: sessions[0], round: round!, studentMessage };
      });
    },

    async heartbeatRound(userId: string, input: {
      discussionId: string;
      roundId: string;
      runnerId: string;
    }) {
      requireUserId(userId);
      const rows = await db.update(classroomDiscussionRounds).set({
        heartbeatAt: new Date(),
      }).where(and(
        eq(classroomDiscussionRounds.id, input.roundId),
        eq(classroomDiscussionRounds.discussionId, input.discussionId),
        eq(classroomDiscussionRounds.userId, userId),
        eq(classroomDiscussionRounds.status, 'running'),
        eq(classroomDiscussionRounds.leaseOwner, input.runnerId),
      )).returning({ abortRequestedAt: classroomDiscussionRounds.abortRequestedAt });
      return rows[0] ?? null;
    },

    async requestAbortRound(userId: string, discussionId: string) {
      requireUserId(userId);
      const rows = await db.update(classroomDiscussionRounds).set({
        abortRequestedAt: new Date(),
      }).where(and(
        eq(classroomDiscussionRounds.discussionId, discussionId),
        eq(classroomDiscussionRounds.userId, userId),
        eq(classroomDiscussionRounds.status, 'running'),
      )).returning();
      if (rows[0]) return rows[0];
      const sessions = await db.select({ id: classroomDiscussionSessions.id })
        .from(classroomDiscussionSessions)
        .where(and(
          eq(classroomDiscussionSessions.id, discussionId),
          eq(classroomDiscussionSessions.userId, userId),
        ))
        .limit(1);
      if (!sessions[0]) throw new OwnershipError('classroom discussion', discussionId);
      return null;
    },

    async startAgentMessage(userId: string, input: {
      discussionId: string;
      roundId: string;
      agentId: string;
      agentName: string;
      agentRole: string;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${input.discussionId}))`);
        const sequences = await transaction
          .select({ next: sql<number>`coalesce(max(${classroomDiscussionMessages.sequence}), 0) + 1` })
          .from(classroomDiscussionMessages)
          .where(and(
            eq(classroomDiscussionMessages.discussionId, input.discussionId),
            eq(classroomDiscussionMessages.userId, userId),
          ));
        const rows = await transaction
          .insert(classroomDiscussionMessages)
          .values({
            discussionId: input.discussionId,
            roundId: input.roundId,
            userId,
            sequence: Number(sequences[0]?.next ?? 1),
            sender: 'agent',
            agentId: input.agentId,
            agentName: input.agentName,
            agentRole: input.agentRole,
          })
          .returning();
        return rows[0]!;
      });
    },

    async updateMessage(userId: string, input: {
      discussionId: string;
      messageId: string;
      content: string;
      actions?: unknown;
      status?: 'streaming' | 'completed' | 'interrupted';
    }) {
      requireUserId(userId);
      const rows = await db
        .update(classroomDiscussionMessages)
        .set({
          content: input.content,
          ...(input.actions ? { actions: input.actions } : {}),
          ...(input.status ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        .where(and(
          eq(classroomDiscussionMessages.id, input.messageId),
          eq(classroomDiscussionMessages.discussionId, input.discussionId),
          eq(classroomDiscussionMessages.userId, userId),
        ))
        .returning();
      if (!rows[0]) throw new OwnershipError('classroom discussion message', input.messageId);
      return rows[0];
    },

    async finishRound(userId: string, input: {
      discussionId: string;
      roundId: string;
      status: 'completed' | 'aborted' | 'failed';
      directorPromptId?: string;
      directorPromptRevision?: string;
      participantPromptId?: string;
      participantPromptRevision?: string;
      modelProviderId?: string;
      modelId?: string;
      errorCode?: string;
      runnerId: string;
    }) {
      requireUserId(userId);
      const rows = await db
        .update(classroomDiscussionRounds)
        .set({
          status: input.status,
          directorPromptId: input.directorPromptId,
          directorPromptRevision: input.directorPromptRevision,
          participantPromptId: input.participantPromptId,
          participantPromptRevision: input.participantPromptRevision,
          modelProviderId: input.modelProviderId,
          modelId: input.modelId,
          errorCode: input.errorCode,
          finishedAt: new Date(),
        })
        .where(and(
          eq(classroomDiscussionRounds.id, input.roundId),
          eq(classroomDiscussionRounds.discussionId, input.discussionId),
          eq(classroomDiscussionRounds.userId, userId),
          eq(classroomDiscussionRounds.status, 'running'),
          eq(classroomDiscussionRounds.leaseOwner, input.runnerId),
        ))
        .returning();
      if (!rows[0]) throw new OwnershipError('running classroom discussion round', input.roundId);
      await db
        .update(classroomDiscussionSessions)
        .set({ updatedAt: new Date() })
        .where(and(
          eq(classroomDiscussionSessions.id, input.discussionId),
          eq(classroomDiscussionSessions.userId, userId),
        ));
      return rows[0];
    },

    async completeSession(userId: string, discussionId: string) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${discussionId}))`);
        const sessions = await transaction.select().from(classroomDiscussionSessions).where(and(
          eq(classroomDiscussionSessions.id, discussionId),
          eq(classroomDiscussionSessions.userId, userId),
          eq(classroomDiscussionSessions.status, 'active'),
        )).limit(1);
        if (!sessions[0]) throw new OwnershipError('active classroom discussion', discussionId);
        const running = await transaction.select({ id: classroomDiscussionRounds.id })
          .from(classroomDiscussionRounds)
          .where(and(
            eq(classroomDiscussionRounds.discussionId, discussionId),
            eq(classroomDiscussionRounds.userId, userId),
            eq(classroomDiscussionRounds.status, 'running'),
          ))
          .limit(1);
        if (running[0]) return { conflict: true as const };
        const rows = await transaction.update(classroomDiscussionSessions)
          .set({ status: 'completed', updatedAt: new Date(), finishedAt: new Date() })
          .where(and(
            eq(classroomDiscussionSessions.id, discussionId),
            eq(classroomDiscussionSessions.userId, userId),
            eq(classroomDiscussionSessions.status, 'active'),
          ))
          .returning();
        if (!rows[0]) throw new OwnershipError('active classroom discussion', discussionId);
        return { conflict: false as const, row: rows[0] };
      });
    },

    async recoverInterrupted(cutoff = new Date(Date.now() - 5 * 60 * 1000)) {
      await db.transaction(async (transaction) => {
        const running = await transaction
          .update(classroomDiscussionRounds)
          .set({ status: 'aborted', errorCode: 'PROCESS_INTERRUPTED', finishedAt: new Date() })
          .where(and(
            eq(classroomDiscussionRounds.status, 'running'),
            lte(classroomDiscussionRounds.heartbeatAt, cutoff),
          ))
          .returning({ id: classroomDiscussionRounds.id });
        if (running.length === 0) return;
        await transaction
          .update(classroomDiscussionMessages)
          .set({ status: 'interrupted', updatedAt: new Date() })
          .where(and(
            eq(classroomDiscussionMessages.status, 'streaming'),
            sql`${classroomDiscussionMessages.roundId} in (${sql.join(running.map((row) => sql`${row.id}`), sql`, `)})`,
          ));
      });
    },
  };
}
