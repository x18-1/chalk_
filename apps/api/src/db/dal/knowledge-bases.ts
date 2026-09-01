import { and, desc, eq } from 'drizzle-orm';

import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import { knowledgeBases, knowledgeDocuments } from '../schema';

function requireUserId(userId: string) {
  if (!userId) throw new AuthRequiredError();
}

export function createKnowledgeBasesDal(db: Database) {
  return {
    async create(userId: string, input: { name: string; description?: string }) {
      requireUserId(userId);
      const rows = await db.insert(knowledgeBases).values({ userId, ...input }).returning();
      return rows[0]!;
    },

    async list(userId: string) {
      requireUserId(userId);
      return db.select().from(knowledgeBases)
        .where(eq(knowledgeBases.userId, userId))
        .orderBy(desc(knowledgeBases.updatedAt));
    },

    async getById(userId: string, id: string) {
      requireUserId(userId);
      const rows = await db.select().from(knowledgeBases)
        .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, userId)))
        .limit(1);
      if (!rows[0]) throw new OwnershipError('knowledge base', id);
      return rows[0];
    },

    async touch(userId: string, id: string) {
      requireUserId(userId);
      const rows = await db.update(knowledgeBases)
        .set({ updatedAt: new Date() })
        .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, userId)))
        .returning();
      if (!rows[0]) throw new OwnershipError('knowledge base', id);
      return rows[0];
    },
  };
}

export function createKnowledgeDocumentsDal(db: Database) {
  return {
    async create(userId: string, input: {
      knowledgeBaseId: string;
      filename: string;
      contentType: string;
      size: number;
      fileKey: string;
    }) {
      requireUserId(userId);
      const kb = await db.select({ id: knowledgeBases.id }).from(knowledgeBases)
        .where(and(eq(knowledgeBases.id, input.knowledgeBaseId), eq(knowledgeBases.userId, userId)))
        .limit(1);
      if (!kb[0]) throw new OwnershipError('knowledge base', input.knowledgeBaseId);
      const rows = await db.insert(knowledgeDocuments).values({ userId, ...input }).returning();
      return rows[0]!;
    },

    async listForKnowledgeBase(userId: string, knowledgeBaseId: string) {
      requireUserId(userId);
      const rows = await db.select().from(knowledgeDocuments)
        .where(and(
          eq(knowledgeDocuments.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeDocuments.userId, userId),
        ))
        .orderBy(desc(knowledgeDocuments.createdAt));
      return rows;
    },

    async getById(userId: string, id: string) {
      requireUserId(userId);
      const rows = await db.select().from(knowledgeDocuments)
        .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.userId, userId)))
        .limit(1);
      if (!rows[0]) throw new OwnershipError('knowledge document', id);
      return rows[0];
    },

    async updateStatus(userId: string, id: string, input: {
      status: string;
      error?: string | null;
      chunkCount?: number | null;
      pageCount?: number | null;
      indexedAt?: Date | null;
    }) {
      requireUserId(userId);
      const rows = await db.update(knowledgeDocuments).set({
        ...input,
        updatedAt: new Date(),
      }).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.userId, userId))).returning();
      if (!rows[0]) throw new OwnershipError('knowledge document', id);
      return rows[0];
    },
  };
}
