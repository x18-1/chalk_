import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';

import { AuthModule, registerAuthRoutes } from './auth/auth-module';
import { loadConfig, type ApiConfig } from './config';
import { getDb } from './db/client';
import { registerErrorHandler } from './http/errors';
import { registerChatRoutes } from './modules/chat/routes';
import { registerConfigurationRoutes } from './modules/configuration/routes';
import { registerMcpRoutes } from './modules/mcp/routes';
import { registerTelemetryRoutes } from './modules/telemetry/routes';
import { registerUploadRoutes } from './modules/uploads/routes';
import { registerAdminRoutes } from './modules/admin/routes';
import { startToolApprovalRecovery } from './agent/approval-recovery';
import { configureAgentRuntime } from './agent/runtime-manager';

export type BuildApiOptions = { config?: ApiConfig };

export async function buildApi(options: BuildApiOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: {
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 1_024 * 1_024,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: [...config.webOrigins],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !config.webOrigins.includes(origin.replace(/\/$/, ''))) {
      return reply.code(403).send({ error: 'Origin is not allowed', code: 'ORIGIN_NOT_ALLOWED' });
    }
  });

  registerErrorHandler(app);
  const db = getDb();
  configureAgentRuntime({ toolApprovalTimeoutMs: config.toolApprovalTimeoutMs });
  const approvalRecovery = await startToolApprovalRecovery(db, {
    timeoutMs: config.toolApprovalTimeoutMs,
    onError(error) {
      app.log.error({ err: error }, 'Unable to recover expired tool approvals');
    },
  });
  if (approvalRecovery.recovered > 0) {
    app.log.warn(
      { count: approvalRecovery.recovered },
      'Rejected expired tool approvals during startup recovery',
    );
  }
  app.addHook('onClose', async () => approvalRecovery.stop());

  const auth = new AuthModule(db, config);
  registerAuthRoutes(app, auth);
  registerChatRoutes(app, auth);
  registerConfigurationRoutes(app, auth);
  registerMcpRoutes(app, auth);
  registerTelemetryRoutes(app, auth);
  registerUploadRoutes(app, auth);
  registerAdminRoutes(app, auth);

  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
