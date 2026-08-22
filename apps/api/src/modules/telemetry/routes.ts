import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import {
  telemetryConversationParamsSchema,
  telemetryListQuerySchema,
  telemetryRunsQuerySchema,
} from './schemas';
import type { TelemetryQueryService } from './services/telemetry-query.service';

export function registerTelemetryRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  telemetry: TelemetryQueryService,
) {
  app.get('/telemetry/spans', async (request) => {
    const user = await auth.requireAdmin(request);
    return telemetry.listRecentSpans(user.id);
  });

  app.get('/telemetry/conversations', async (request) => {
    const user = await auth.requireAdmin(request);
    const { limit, offset } = telemetryListQuerySchema.parse(request.query);
    return telemetry.listConversations(user.id, limit, offset);
  });

  app.get('/telemetry/conversations/:conversationId', async (request) => {
    const user = await auth.requireAdmin(request);
    const { conversationId } = telemetryConversationParamsSchema.parse(request.params);
    const { limit } = telemetryRunsQuerySchema.parse(request.query);
    return telemetry.getConversation(user.id, conversationId, limit);
  });
}
