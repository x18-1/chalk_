import { and, desc, eq } from 'drizzle-orm';

import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import {
  classroomArtifactMedia,
  classroomArtifacts,
  classroomDrafts,
  classroomGenerationRuns,
  classrooms,
} from '../schema';

function requireUserId(userId: string) {
  if (!userId) throw new AuthRequiredError();
}

export function createClassroomsDal(db: Database) {
  return {
    async createWithArtifact(userId: string, input: {
      classroomId: string;
      artifactId: string;
      title: string;
      description?: string;
      sourceKey?: string;
      document: unknown;
      contentHash: string;
      media?: Array<{
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
        const classroomRows = await transaction
          .insert(classrooms)
          .values({
            id: input.classroomId,
            userId,
            title: input.title,
            description: input.description,
            sourceKey: input.sourceKey,
          })
          .returning();
        const artifactRows = await transaction
          .insert(classroomArtifacts)
          .values({
            id: input.artifactId,
            classroomId: input.classroomId,
            userId,
            version: 1,
            document: input.document,
            contentHash: input.contentHash,
          })
          .returning();
        if (input.media?.length) {
          await transaction.insert(classroomArtifactMedia).values(input.media.map((media) => ({
            ...media,
            artifactId: input.artifactId,
            classroomId: input.classroomId,
            userId,
          })));
        }
        return { classroom: classroomRows[0]!, artifact: artifactRows[0]! };
      });
    },

    async list(userId: string) {
      requireUserId(userId);
      const rows = await db
        .select({
          classroom: classrooms,
          artifact: classroomArtifacts,
          draft: classroomDrafts,
          run: classroomGenerationRuns,
        })
        .from(classrooms)
        .leftJoin(classroomArtifacts, and(
          eq(classroomArtifacts.classroomId, classrooms.id),
          eq(classroomArtifacts.userId, userId),
        ))
        .leftJoin(classroomDrafts, and(
          eq(classroomDrafts.classroomId, classrooms.id),
          eq(classroomDrafts.userId, userId),
        ))
        .leftJoin(classroomGenerationRuns, and(
          eq(classroomGenerationRuns.draftId, classroomDrafts.id),
          eq(classroomGenerationRuns.userId, userId),
        ))
        .where(eq(classrooms.userId, userId))
        .orderBy(desc(classrooms.updatedAt));

      const latestByClassroom = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const current = latestByClassroom.get(row.classroom.id);
        if (!current) {
          latestByClassroom.set(row.classroom.id, row);
          continue;
        }
        const artifact = !current.artifact || (row.artifact?.version ?? 0) > current.artifact.version
          ? row.artifact
          : current.artifact;
        const run = !current.run || (row.run?.updatedAt.getTime() ?? 0) > current.run.updatedAt.getTime()
          ? row.run
          : current.run;
        const draft = run === row.run ? row.draft : current.draft;
        latestByClassroom.set(row.classroom.id, { ...current, artifact, draft, run });
      }
      return [...latestByClassroom.values()];
    },

    async getClassroom(userId: string, classroomId: string) {
      requireUserId(userId);
      const rows = await db
        .select()
        .from(classrooms)
        .where(and(eq(classrooms.id, classroomId), eq(classrooms.userId, userId)))
        .limit(1);
      if (!rows[0]) throw new OwnershipError('classroom', classroomId);
      return rows[0];
    },

    async getBySourceKey(userId: string, sourceKey: string) {
      requireUserId(userId);
      const rows = await db
        .select({ classroom: classrooms, artifact: classroomArtifacts })
        .from(classrooms)
        .innerJoin(classroomArtifacts, and(
          eq(classroomArtifacts.classroomId, classrooms.id),
          eq(classroomArtifacts.userId, userId),
        ))
        .where(and(eq(classrooms.userId, userId), eq(classrooms.sourceKey, sourceKey)))
        .orderBy(desc(classroomArtifacts.version))
        .limit(1);
      return rows[0] ?? null;
    },

    async addArtifact(userId: string, input: {
      classroomId: string;
      artifactId: string;
      document: unknown;
      contentHash: string;
      media?: Array<{
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
        const classroomRows = await transaction
          .select()
          .from(classrooms)
          .where(and(eq(classrooms.id, input.classroomId), eq(classrooms.userId, userId)))
          .limit(1);
        const classroom = classroomRows[0];
        if (!classroom) throw new OwnershipError('classroom', input.classroomId);

        const latestRows = await transaction
          .select({ version: classroomArtifacts.version })
          .from(classroomArtifacts)
          .where(and(
            eq(classroomArtifacts.classroomId, input.classroomId),
            eq(classroomArtifacts.userId, userId),
          ))
          .orderBy(desc(classroomArtifacts.version))
          .limit(1);
        const artifactRows = await transaction
          .insert(classroomArtifacts)
          .values({
            id: input.artifactId,
            classroomId: input.classroomId,
            userId,
            version: (latestRows[0]?.version ?? 0) + 1,
            document: input.document,
            contentHash: input.contentHash,
          })
          .returning();
        if (input.media?.length) {
          await transaction.insert(classroomArtifactMedia).values(input.media.map((media) => ({
            ...media,
            artifactId: input.artifactId,
            classroomId: input.classroomId,
            userId,
          })));
        }
        const updatedRows = await transaction
          .update(classrooms)
          .set({ updatedAt: new Date() })
          .where(and(eq(classrooms.id, input.classroomId), eq(classrooms.userId, userId)))
          .returning();
        return { classroom: updatedRows[0]!, artifact: artifactRows[0]! };
      });
    },

    async migrateLegacyArtifact(userId: string, input: {
      classroomId: string;
      artifactId: string;
      document: unknown;
      contentHash: string;
    }) {
      requireUserId(userId);
      const rows = await db
        .update(classroomArtifacts)
        .set({
          document: input.document,
          contentHash: input.contentHash,
          contentObjectKey: null,
        })
        .where(and(
          eq(classroomArtifacts.id, input.artifactId),
          eq(classroomArtifacts.classroomId, input.classroomId),
          eq(classroomArtifacts.userId, userId),
        ))
        .returning();
      if (!rows[0]) throw new OwnershipError('classroom artifact', input.artifactId);
      return rows[0];
    },

    async getArtifact(userId: string, classroomId: string, artifactId: string) {
      requireUserId(userId);
      const rows = await db
        .select({ classroom: classrooms, artifact: classroomArtifacts })
        .from(classroomArtifacts)
        .innerJoin(classrooms, and(
          eq(classrooms.id, classroomArtifacts.classroomId),
          eq(classrooms.userId, classroomArtifacts.userId),
        ))
        .where(and(
          eq(classroomArtifacts.id, artifactId),
          eq(classroomArtifacts.classroomId, classroomId),
          eq(classroomArtifacts.userId, userId),
          eq(classrooms.userId, userId),
        ))
        .limit(1);
      if (!rows[0]) throw new OwnershipError('classroom artifact', artifactId);
      return rows[0];
    },

    async listArtifactMedia(userId: string, classroomId: string, artifactId: string) {
      requireUserId(userId);
      return db
        .select()
        .from(classroomArtifactMedia)
        .where(and(
          eq(classroomArtifactMedia.artifactId, artifactId),
          eq(classroomArtifactMedia.classroomId, classroomId),
          eq(classroomArtifactMedia.userId, userId),
        ));
    },
  };
}
