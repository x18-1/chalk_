import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthModule } from '../../auth/auth-module';
import { listRuntimeSpans } from '../../agent/telemetry';
import { getDb } from '../../db/client';
import { createAgentRunObservationsDal } from '../../db/dal';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const conversationParams = z.object({ conversationId: z.string().uuid() });
const runsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100) });

export function registerTelemetryRoutes(app: FastifyInstance, auth: AuthModule) {
  app.get('/telemetry/spans', async (request) => {
    const user = await auth.requireAdmin(request);
    return { spans: listRuntimeSpans(user.id).slice(-100) };
  });

  app.get('/telemetry/conversations', async (request) => {
    await auth.requireAdmin(request);
    const { limit, offset } = listQuery.parse(request.query);
    const observations = createAgentRunObservationsDal(getDb());
    return { conversations: await observations.listConversationSummariesForAdmin(limit, offset) };
  });

  app.get('/telemetry/conversations/:conversationId', async (request) => {
    await auth.requireAdmin(request);
    const { conversationId } = conversationParams.parse(request.params);
    const { limit } = runsQuery.parse(request.query);
    const observations = createAgentRunObservationsDal(getDb());
    const summary = await observations.getConversationSummaryForAdmin(conversationId);
    if (!summary) return { summary: null, runs: [] };
    return {
      summary,
      runs: await observations.listForConversationForAdmin(conversationId, limit),
    };
  });
}
