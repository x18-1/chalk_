import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import type { AgentRunObservation } from '@chalk/agent-runtime';

import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import { agentRunObservations, conversations } from '../schema';

function requireUserId(userId: string) {
  if (!userId) throw new AuthRequiredError();
}

const runCount = sql<number>`count(*)::int`;
const completedRunCount = sql<number>`count(*) filter (where ${agentRunObservations.status} = 'completed')::int`;
const abortedRunCount = sql<number>`count(*) filter (where ${agentRunObservations.status} = 'aborted')::int`;
const failedRunCount = sql<number>`count(*) filter (where ${agentRunObservations.status} = 'failed')::int`;
const inputTokenTotal = sql<number>`coalesce(sum(${agentRunObservations.inputTokens}), 0)::int`;
const outputTokenTotal = sql<number>`coalesce(sum(${agentRunObservations.outputTokens}), 0)::int`;
const totalCost = sql<number>`coalesce(sum(${agentRunObservations.totalCost}), 0)::float8`;

type AdminConversationSummary = {
  conversationId: string;
  title: string | null;
  sessionId: string;
  runCount: number;
  statusCounts: { completed: number; aborted: number; failed: number };
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  firstStartedAt: Date;
  lastStartedAt: Date;
  latestErrorCategory: string | null;
};

type AdminSummaryRow = {
  conversationId: string;
  title: string | null;
  sessionId: string;
  runCount: number;
  completedRunCount: number;
  abortedRunCount: number;
  failedRunCount: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  firstStartedAt: Date;
  lastStartedAt: Date;
};

export function createAgentRunObservationsDal(db: Database) {
  async function requireOwnedConversation(userId: string, conversationId: string) {
    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1);
    if (!rows[0]) throw new OwnershipError('conversation', conversationId);
  }

  async function hydrateAdminSummaries(summaries: AdminSummaryRow[]): Promise<AdminConversationSummary[]> {
    if (summaries.length === 0) return [];

    const conversationIds = summaries.map((summary) => summary.conversationId);
    const errors = await db
      .select({
        conversationId: agentRunObservations.conversationId,
        errorCategory: agentRunObservations.errorCategory,
      })
      .from(agentRunObservations)
      .where(and(
        inArray(agentRunObservations.conversationId, conversationIds),
        isNotNull(agentRunObservations.errorCategory),
      ))
      .orderBy(desc(agentRunObservations.startedAt));
    const latestErrorByConversation = new Map<string, string>();
    for (const error of errors) {
      if (error.errorCategory !== null && !latestErrorByConversation.has(error.conversationId)) {
        latestErrorByConversation.set(error.conversationId, error.errorCategory);
      }
    }

    return summaries.map((summary) => ({
      conversationId: summary.conversationId,
      title: summary.title,
      sessionId: summary.sessionId,
      runCount: summary.runCount,
      statusCounts: {
        completed: summary.completedRunCount,
        aborted: summary.abortedRunCount,
        failed: summary.failedRunCount,
      },
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      totalCost: summary.totalCost,
      firstStartedAt: summary.firstStartedAt,
      lastStartedAt: summary.lastStartedAt,
      latestErrorCategory: latestErrorByConversation.get(summary.conversationId) ?? null,
    }));
  }

  function adminSummarySelection() {
    return {
      conversationId: agentRunObservations.conversationId,
      title: conversations.title,
      sessionId: agentRunObservations.sessionId,
      runCount,
      completedRunCount,
      abortedRunCount,
      failedRunCount,
      inputTokens: inputTokenTotal,
      outputTokens: outputTokenTotal,
      totalCost,
      firstStartedAt: sql<Date>`min(${agentRunObservations.startedAt})`,
      lastStartedAt: sql<Date>`max(${agentRunObservations.startedAt})`,
    };
  }

  return {
    async record(userId: string, input: {
      conversationId: string;
      sessionId: string;
      modelProviderId?: string;
      modelId?: string;
      observation: AgentRunObservation;
    }) {
      requireUserId(userId);
      await requireOwnedConversation(userId, input.conversationId);
      const rows = await db
        .insert(agentRunObservations)
        .values({
          userId,
          conversationId: input.conversationId,
          sessionId: input.sessionId,
          modelProviderId: input.modelProviderId,
          modelId: input.modelId,
          status: input.observation.status,
          durationMs: input.observation.durationMs,
          inputTokens: input.observation.inputTokens,
          outputTokens: input.observation.outputTokens,
          totalCost: input.observation.totalCost,
          errorCategory: input.observation.errorCategory,
          startedAt: new Date(input.observation.startedAt),
          finishedAt: new Date(input.observation.startedAt + input.observation.durationMs),
        })
        .returning();
      return rows[0]!;
    },

    async listForConversation(userId: string, conversationId: string, limit = 100) {
      requireUserId(userId);
      await requireOwnedConversation(userId, conversationId);
      return db
        .select()
        .from(agentRunObservations)
        .where(and(
          eq(agentRunObservations.userId, userId),
          eq(agentRunObservations.conversationId, conversationId),
        ))
        .orderBy(desc(agentRunObservations.startedAt))
        .limit(limit);
    },

    async listConversationSummariesForAdmin(limit = 50, offset = 0): Promise<AdminConversationSummary[]> {
      const summaries = await db
        .select(adminSummarySelection())
        .from(agentRunObservations)
        .innerJoin(conversations, eq(agentRunObservations.conversationId, conversations.id))
        .groupBy(agentRunObservations.conversationId, conversations.title, agentRunObservations.sessionId)
        .orderBy(desc(sql`max(${agentRunObservations.startedAt})`))
        .limit(limit)
        .offset(offset);
      return hydrateAdminSummaries(summaries);
    },

    async getConversationSummaryForAdmin(conversationId: string) {
      const summaries = await db
        .select(adminSummarySelection())
        .from(agentRunObservations)
        .innerJoin(conversations, eq(agentRunObservations.conversationId, conversations.id))
        .where(eq(agentRunObservations.conversationId, conversationId))
        .groupBy(agentRunObservations.conversationId, conversations.title, agentRunObservations.sessionId)
        .limit(1);
      return (await hydrateAdminSummaries(summaries))[0] ?? null;
    },

    async listForConversationForAdmin(conversationId: string, limit = 100) {
      return db
        .select({
          id: agentRunObservations.id,
          conversationId: agentRunObservations.conversationId,
          sessionId: agentRunObservations.sessionId,
          modelProviderId: agentRunObservations.modelProviderId,
          modelId: agentRunObservations.modelId,
          status: agentRunObservations.status,
          durationMs: agentRunObservations.durationMs,
          inputTokens: agentRunObservations.inputTokens,
          outputTokens: agentRunObservations.outputTokens,
          totalCost: agentRunObservations.totalCost,
          errorCategory: agentRunObservations.errorCategory,
          startedAt: agentRunObservations.startedAt,
          finishedAt: agentRunObservations.finishedAt,
        })
        .from(agentRunObservations)
        .where(eq(agentRunObservations.conversationId, conversationId))
        .orderBy(desc(agentRunObservations.startedAt))
        .limit(limit);
    },
  };
}
