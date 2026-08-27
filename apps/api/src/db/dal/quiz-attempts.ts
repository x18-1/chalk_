import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import {
  classroomArtifacts,
  classroomLearningSessions,
  classroomQuizAttempts,
} from '../schema';

function requireUserId(userId: string) {
  if (!userId) throw new AuthRequiredError();
}

export function createQuizAttemptsDal(db: Database) {
  return {
    async getSessionContext(userId: string, learningSessionId: string) {
      requireUserId(userId);
      const rows = await db
        .select({
          session: classroomLearningSessions,
          document: classroomArtifacts.document,
        })
        .from(classroomLearningSessions)
        .innerJoin(classroomArtifacts, and(
          eq(classroomArtifacts.id, classroomLearningSessions.artifactId),
          eq(classroomArtifacts.classroomId, classroomLearningSessions.classroomId),
          eq(classroomArtifacts.userId, classroomLearningSessions.userId),
        ))
        .where(and(
          eq(classroomLearningSessions.id, learningSessionId),
          eq(classroomLearningSessions.userId, userId),
          eq(classroomArtifacts.userId, userId),
        ))
        .limit(1);
      if (!rows[0]) throw new OwnershipError('learning session', learningSessionId);
      return rows[0];
    },

    async list(userId: string, learningSessionId: string) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const owned = await transaction
          .select({ id: classroomLearningSessions.id })
          .from(classroomLearningSessions)
          .where(and(
            eq(classroomLearningSessions.id, learningSessionId),
            eq(classroomLearningSessions.userId, userId),
          ))
          .limit(1);
        if (!owned[0]) throw new OwnershipError('learning session', learningSessionId);
        return transaction
          .select()
          .from(classroomQuizAttempts)
          .where(and(
            eq(classroomQuizAttempts.learningSessionId, learningSessionId),
            eq(classroomQuizAttempts.userId, userId),
          ));
      });
    },

    async save(userId: string, input: {
      learningSessionId: string;
      classroomId: string;
      artifactId: string;
      sceneId: string;
      expectedRevision: number;
      answers: Record<string, string[]>;
      results: unknown[];
      score: number;
      maxScore: number;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const now = new Date();
        if (input.expectedRevision === 0) {
          const inserted = await transaction
            .insert(classroomQuizAttempts)
            .values({
              learningSessionId: input.learningSessionId,
              classroomId: input.classroomId,
              artifactId: input.artifactId,
              userId,
              sceneId: input.sceneId,
              answers: input.answers,
              results: input.results,
              score: input.score,
              maxScore: input.maxScore,
              submittedAt: now,
            })
            .onConflictDoNothing({
              target: [classroomQuizAttempts.learningSessionId, classroomQuizAttempts.sceneId],
            })
            .returning();
          if (inserted[0]) return { row: inserted[0], created: true };
        } else {
          const updated = await transaction
            .update(classroomQuizAttempts)
            .set({
              answers: input.answers,
              results: input.results,
              score: input.score,
              maxScore: input.maxScore,
              revision: sql`${classroomQuizAttempts.revision} + 1`,
              submittedAt: now,
              updatedAt: now,
            })
            .where(and(
              eq(classroomQuizAttempts.learningSessionId, input.learningSessionId),
              eq(classroomQuizAttempts.sceneId, input.sceneId),
              eq(classroomQuizAttempts.userId, userId),
              eq(classroomQuizAttempts.artifactId, input.artifactId),
              eq(classroomQuizAttempts.classroomId, input.classroomId),
              eq(classroomQuizAttempts.revision, input.expectedRevision),
            ))
            .returning();
          if (updated[0]) return { row: updated[0], created: false };
        }

        const owned = await transaction
          .select({ id: classroomLearningSessions.id })
          .from(classroomLearningSessions)
          .where(and(
            eq(classroomLearningSessions.id, input.learningSessionId),
            eq(classroomLearningSessions.userId, userId),
            eq(classroomLearningSessions.artifactId, input.artifactId),
            eq(classroomLearningSessions.classroomId, input.classroomId),
          ))
          .limit(1);
        if (!owned[0]) throw new OwnershipError('learning session', input.learningSessionId);
        return null;
      });
    },
  };
}
