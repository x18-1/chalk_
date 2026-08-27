import { and, eq, sql } from 'drizzle-orm';
import type { RuntimeSnapshot } from '@chalk/chalkboard';

import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import { classroomArtifacts, classroomLearningSessions } from '../schema';

function requireUserId(userId: string) {
  if (!userId) throw new AuthRequiredError();
}

export function createLearningSessionsDal(db: Database) {
  return {
    async createOrResume(userId: string, input: {
      classroomId: string;
      artifactId: string;
      initialCursor(document: unknown): RuntimeSnapshot;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const artifacts = await transaction
          .select({ document: classroomArtifacts.document })
          .from(classroomArtifacts)
          .where(and(
            eq(classroomArtifacts.id, input.artifactId),
            eq(classroomArtifacts.classroomId, input.classroomId),
            eq(classroomArtifacts.userId, userId),
          ))
          .limit(1);
        const artifact = artifacts[0];
        if (!artifact) throw new OwnershipError('classroom artifact', input.artifactId);
        if (artifact.document === null) {
          throw new Error(`Classroom artifact ${input.artifactId} has not been migrated to PostgreSQL`);
        }

        const cursor = input.initialCursor(artifact.document);
        const inserted = await transaction
          .insert(classroomLearningSessions)
          .values({
            classroomId: input.classroomId,
            artifactId: input.artifactId,
            userId,
            cursorVersion: cursor.version,
            stageId: cursor.stageId,
            sceneId: cursor.sceneId,
            sceneIndex: cursor.sceneIndex,
            actionIndex: cursor.actionIndex,
            mode: cursor.mode,
            completed: cursor.completed,
          })
          .onConflictDoNothing({
            target: [classroomLearningSessions.userId, classroomLearningSessions.artifactId],
          })
          .returning();

        const rows = inserted.length > 0
          ? inserted
          : await transaction
              .select()
              .from(classroomLearningSessions)
              .where(and(
                eq(classroomLearningSessions.artifactId, input.artifactId),
                eq(classroomLearningSessions.classroomId, input.classroomId),
                eq(classroomLearningSessions.userId, userId),
              ))
              .limit(1);
        if (!rows[0]) throw new OwnershipError('learning session', input.artifactId);
        return { row: rows[0], created: inserted.length > 0 };
      });
    },

    async get(userId: string, sessionId: string) {
      requireUserId(userId);
      const rows = await db
        .select({ session: classroomLearningSessions, document: classroomArtifacts.document })
        .from(classroomLearningSessions)
        .innerJoin(classroomArtifacts, and(
          eq(classroomArtifacts.id, classroomLearningSessions.artifactId),
          eq(classroomArtifacts.classroomId, classroomLearningSessions.classroomId),
          eq(classroomArtifacts.userId, classroomLearningSessions.userId),
        ))
        .where(and(
          eq(classroomLearningSessions.id, sessionId),
          eq(classroomLearningSessions.userId, userId),
          eq(classroomArtifacts.userId, userId),
        ))
        .limit(1);
      if (!rows[0]) throw new OwnershipError('learning session', sessionId);
      return rows[0];
    },

    async saveCursor(userId: string, input: {
      sessionId: string;
      expectedRevision: number;
      cursor: RuntimeSnapshot;
    }) {
      requireUserId(userId);
      return db.transaction(async (transaction) => {
        const rows = await transaction
          .update(classroomLearningSessions)
          .set({
            cursorVersion: input.cursor.version,
            stageId: input.cursor.stageId,
            sceneId: input.cursor.sceneId,
            sceneIndex: input.cursor.sceneIndex,
            actionIndex: input.cursor.actionIndex,
            mode: input.cursor.mode,
            completed: input.cursor.completed,
            revision: sql`${classroomLearningSessions.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(classroomLearningSessions.id, input.sessionId),
            eq(classroomLearningSessions.userId, userId),
            eq(classroomLearningSessions.revision, input.expectedRevision),
          ))
          .returning();
        if (rows[0]) return rows[0];

        const owned = await transaction
          .select({ id: classroomLearningSessions.id })
          .from(classroomLearningSessions)
          .where(and(
            eq(classroomLearningSessions.id, input.sessionId),
            eq(classroomLearningSessions.userId, userId),
          ))
          .limit(1);
        if (!owned[0]) throw new OwnershipError('learning session', input.sessionId);
        return null;
      });
    },
  };
}
