import { and, eq } from 'drizzle-orm';

import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import { agentSettings, conversations, skillSettings, subagentRuns, toolSettings } from '../schema';

function requireUserId(userId: string) {
  if (!userId) throw new AuthRequiredError();
}

export function createAgentSettingsDal(db: Database) {
  return {
    async get(userId: string) {
      requireUserId(userId);
      const rows = await db
        .select()
        .from(agentSettings)
        .where(eq(agentSettings.userId, userId))
        .limit(1);
      return rows[0] ?? null;
    },

    async setDefaultModel(
      userId: string,
      model: { providerId: string; modelId: string },
    ) {
      requireUserId(userId);
      const rows = await db
        .insert(agentSettings)
        .values({
          userId,
          defaultProviderId: model.providerId,
          defaultModelId: model.modelId,
        })
        .onConflictDoUpdate({
          target: agentSettings.userId,
          set: {
            defaultProviderId: model.providerId,
            defaultModelId: model.modelId,
            updatedAt: new Date(),
          },
        })
        .returning();
      return rows[0]!;
    },
  };
}

export function createSkillSettingsDal(db: Database) {
  return {
    async list(userId: string) {
      requireUserId(userId);
      return db
        .select()
        .from(skillSettings)
        .where(eq(skillSettings.userId, userId));
    },

    async setEnabled(userId: string, skillName: string, enabled: boolean) {
      requireUserId(userId);
      const rows = await db
        .insert(skillSettings)
        .values({ userId, skillName, enabled })
        .onConflictDoUpdate({
          target: [skillSettings.userId, skillSettings.skillName],
          set: { enabled, updatedAt: new Date() },
        })
        .returning();
      return rows[0]!;
    },
  };
}

export function createToolSettingsDal(db: Database) {
  return {
    async list(userId: string) {
      requireUserId(userId);
      return db
        .select()
        .from(toolSettings)
        .where(eq(toolSettings.userId, userId));
    },

    async upsert(
      userId: string,
      toolName: string,
      data: { enabled: boolean; approval: 'default' | 'always' | 'never' },
    ) {
      requireUserId(userId);
      const rows = await db
        .insert(toolSettings)
        .values({ userId, toolName, ...data })
        .onConflictDoUpdate({
          target: [toolSettings.userId, toolSettings.toolName],
          set: { ...data, updatedAt: new Date() },
        })
        .returning();
      return rows[0]!;
    },
  };
}

export function createSubagentRunsDal(db: Database) {
  return {
    async start(userId: string, data: {
      conversationId: string;
      parentSessionId: string;
      childSessionId: string;
      timeoutMs: number;
      modelProviderId?: string;
      modelId?: string;
      toolNames?: readonly string[];
    }) {
      requireUserId(userId);
      const ownedConversation = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, data.conversationId), eq(conversations.userId, userId)))
        .limit(1);
      if (!ownedConversation[0]) throw new OwnershipError('conversation', data.conversationId);
      const rows = await db
        .insert(subagentRuns)
        .values({
          userId,
          conversationId: data.conversationId,
          parentSessionId: data.parentSessionId,
          childSessionId: data.childSessionId,
          timeoutMs: data.timeoutMs,
          ...(data.modelProviderId ? { modelProviderId: data.modelProviderId } : {}),
          ...(data.modelId ? { modelId: data.modelId } : {}),
          ...(data.toolNames ? { toolNames: [...data.toolNames] } : {}),
        })
        .returning();
      return rows[0]!;
    },

    async finish(userId: string, runId: string, data: {
      status: 'completed' | 'aborted' | 'timed_out' | 'failed';
      error?: string | null;
    }) {
      requireUserId(userId);
      const rows = await db
        .update(subagentRuns)
        .set({ ...data, finishedAt: new Date() })
        .where(and(eq(subagentRuns.id, runId), eq(subagentRuns.userId, userId)))
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Subagent run ownership mismatch');
      return row;
    },

    async list(userId: string, conversationId?: string) {
      requireUserId(userId);
      return db
        .select()
        .from(subagentRuns)
        .where(
          conversationId
            ? and(
                eq(subagentRuns.conversationId, conversationId),
                eq(subagentRuns.userId, userId),
              )
            : eq(subagentRuns.userId, userId),
        );
    },
  };
}
