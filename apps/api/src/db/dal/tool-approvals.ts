import { and, eq, lt } from 'drizzle-orm';
import type { Database } from '../client';
import { toolApprovals, conversations } from '../schema/index';
import {
  AuthRequiredError,
  OwnershipError,
  ToolApprovalAlreadyDecidedError,
} from '../errors';

export function createToolApprovalsDal(db: Database) {
  return {
    async rejectExpiredPending(createdBefore: Date) {
      const result = await db
        .update(toolApprovals)
        .set({ status: 'rejected', decidedAt: new Date() })
        .where(
          and(
            eq(toolApprovals.status, 'pending'),
            lt(toolApprovals.createdAt, createdBefore),
          ),
        )
        .returning({ id: toolApprovals.id });

      return result.length;
    },

    async rejectPendingByConversation(userId: string, conversationId: string) {
      if (!userId) throw new AuthRequiredError();

      const owned = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
          ),
        )
        .limit(1);

      if (!owned[0]) {
        throw new OwnershipError('conversation', conversationId);
      }

      const result = await db
        .update(toolApprovals)
        .set({ status: 'rejected', decidedAt: new Date() })
        .where(
          and(
            eq(toolApprovals.conversationId, conversationId),
            eq(toolApprovals.status, 'pending'),
          ),
        )
        .returning({ id: toolApprovals.id });

      return result.length;
    },

    async listByConversation(userId: string, conversationId: string) {
      if (!userId) throw new AuthRequiredError();

      // Verify ownership via join
      const result = await db
        .select({ approval: toolApprovals })
        .from(toolApprovals)
        .innerJoin(conversations, eq(toolApprovals.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
          ),
        );

      return result.map((r) => r.approval);
    },

    async create(userId: string, data: {
      conversationId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
    }) {
      if (!userId) throw new AuthRequiredError();

      // Verify conversation ownership first
      const conv = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, data.conversationId),
            eq(conversations.userId, userId),
          ),
        )
        .limit(1);

      if (!conv[0]) {
        throw new OwnershipError('conversation', data.conversationId);
      }

      const result = await db
        .insert(toolApprovals)
        .values(data)
        .returning();

      return result[0]!;
    },

    async updateStatus(userId: string, approvalId: string, status: 'approved' | 'rejected') {
      if (!userId) throw new AuthRequiredError();

      // Verify ownership via join
      const result = await db
        .update(toolApprovals)
        .set({ status, decidedAt: new Date() })
        .from(conversations)
        .where(
          and(
            eq(toolApprovals.id, approvalId),
            eq(toolApprovals.status, 'pending'),
            eq(toolApprovals.conversationId, conversations.id),
            eq(conversations.userId, userId),
          ),
        )
        .returning({ approval: toolApprovals });

      if (!result[0]) {
        const existing = await db
          .select({
            status: toolApprovals.status,
            toolCallId: toolApprovals.toolCallId,
          })
          .from(toolApprovals)
          .innerJoin(conversations, eq(toolApprovals.conversationId, conversations.id))
          .where(
            and(
              eq(toolApprovals.id, approvalId),
              eq(conversations.userId, userId),
            ),
          )
          .limit(1);
        if (existing[0]) {
          throw new ToolApprovalAlreadyDecidedError(
            existing[0].toolCallId,
            existing[0].status,
          );
        }
        throw new OwnershipError('tool_approval', approvalId);
      }

      return result[0].approval;
    },

    async updateStatusByToolCall(
      userId: string,
      conversationId: string,
      toolCallId: string,
      status: 'approved' | 'rejected',
    ) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .update(toolApprovals)
        .set({ status, decidedAt: new Date() })
        .from(conversations)
        .where(
          and(
            eq(toolApprovals.conversationId, conversationId),
            eq(toolApprovals.toolCallId, toolCallId),
            eq(toolApprovals.status, 'pending'),
            eq(toolApprovals.conversationId, conversations.id),
            eq(conversations.userId, userId),
          ),
        )
        .returning({ approval: toolApprovals });

      if (!result[0]) {
        const existing = await db
          .select({ status: toolApprovals.status })
          .from(toolApprovals)
          .innerJoin(conversations, eq(toolApprovals.conversationId, conversations.id))
          .where(
            and(
              eq(toolApprovals.conversationId, conversationId),
              eq(toolApprovals.toolCallId, toolCallId),
              eq(conversations.userId, userId),
            ),
          )
          .limit(1);
        if (existing[0]) {
          throw new ToolApprovalAlreadyDecidedError(toolCallId, existing[0].status);
        }
        throw new OwnershipError('tool_approval', toolCallId);
      }
      return result[0].approval;
    },
  };
}
