import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '../client';
import { conversations } from '../schema/index';
import { AuthRequiredError, OwnershipError } from '../errors';

export function createConversationsDal(db: Database) {
  return {
    async list(userId: string, limit = 50, offset = 0) {
      if (!userId) throw new AuthRequiredError();

      return db
        .select()
        .from(conversations)
        .where(eq(conversations.userId, userId))
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset);
    },

    async getById(userId: string, conversationId: string) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
          ),
        )
        .limit(1);

      if (!result[0]) {
        throw new OwnershipError('conversation', conversationId);
      }

      return result[0];
    },

    async create(userId: string, data: {
      title?: string;
      sessionId: string;
      sessionFilePath: string;
      sessionBackend?: string;
    }) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .insert(conversations)
        .values({
          userId,
          title: data.title,
          sessionId: data.sessionId,
          sessionFilePath: data.sessionFilePath,
          sessionBackend: data.sessionBackend ?? 'jsonl',
        })
        .returning();

      return result[0]!;
    },

    async update(userId: string, conversationId: string, data: {
      title?: string;
      sessionFilePath?: string;
    }) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .update(conversations)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
          ),
        )
        .returning();

      if (!result[0]) {
        throw new OwnershipError('conversation', conversationId);
      }

      return result[0];
    },

    async delete(userId: string, conversationId: string) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .delete(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
          ),
        )
        .returning();

      if (!result[0]) {
        throw new OwnershipError('conversation', conversationId);
      }

      return result[0];
    },
  };
}
