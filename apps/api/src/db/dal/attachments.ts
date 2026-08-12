import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import { attachments, conversations } from '../schema';

export function createAttachmentsDal(db: Database) {
  return {
    async create(userId: string, data: {
      conversationId: string;
      fileKey: string;
      filename: string;
      contentType: string;
      size: number;
      publicUrl?: string;
    }) {
      if (!userId) throw new AuthRequiredError();
      const ownedConversation = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, data.conversationId), eq(conversations.userId, userId)))
        .limit(1);
      if (!ownedConversation[0]) throw new OwnershipError('conversation', data.conversationId);
      const rows = await db.insert(attachments).values({ userId, ...data }).returning();
      return rows[0]!;
    },

    async getById(userId: string, attachmentId: string) {
      if (!userId) throw new AuthRequiredError();
      const rows = await db.select().from(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.userId, userId))).limit(1);
      if (!rows[0]) throw new OwnershipError('attachment', attachmentId);
      return rows[0];
    },

    async listForConversation(userId: string, conversationId: string, ids: readonly string[]) {
      if (!userId) throw new AuthRequiredError();
      if (!ids.length) return [];
      const rows = await db.select().from(attachments).where(and(eq(attachments.userId, userId), eq(attachments.conversationId, conversationId), inArray(attachments.id, ids)));
      if (rows.length !== ids.length) throw new OwnershipError('attachment', ids.find((id) => !rows.some((row) => row.id === id)) ?? 'unknown');
      return rows;
    },

    async confirm(userId: string, attachmentId: string, publicUrl?: string) {
      if (!userId) throw new AuthRequiredError();
      const rows = await db.update(attachments).set({ status: 'ready', ...(publicUrl ? { publicUrl } : {}), confirmedAt: new Date() }).where(and(eq(attachments.id, attachmentId), eq(attachments.userId, userId))).returning();
      if (!rows[0]) throw new OwnershipError('attachment', attachmentId);
      return rows[0];
    },
  };
}
