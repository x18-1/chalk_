import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import { listRuntimeSpans } from '../../agent/telemetry';

export function registerTelemetryRoutes(app: FastifyInstance, auth: AuthModule) {
  app.get('/telemetry/spans', async (request) => {
    const user = await auth.requireAdmin(request);
    return { spans: listRuntimeSpans(user.id).slice(-100) };
  });
}
