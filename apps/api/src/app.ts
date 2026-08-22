import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';

import { AuthModule } from './auth/auth-module';
import { AuthService } from './auth/auth.service';
import { registerAuthRoutes } from './auth/routes';
import { loadConfig, type ApiConfig } from './config';
import { getDb } from './db/client';
import { registerErrorHandler } from './http/errors';
import { registerChatRoutes } from './modules/chat/routes';
import { ChatService } from './modules/chat/services/chat.service';
import { registerConfigurationRoutes } from './modules/configuration/routes';
import { ProviderConfigurationService } from './modules/configuration/services/provider-configuration.service';
import { RuntimeConfigurationService } from './modules/configuration/services/runtime-configuration.service';
import { registerMcpRoutes } from './modules/mcp/routes';
import { McpServerService } from './modules/mcp/services/mcp-server.service';
import { registerTelemetryRoutes } from './modules/telemetry/routes';
import { TelemetryQueryService } from './modules/telemetry/services/telemetry-query.service';
import { registerUploadRoutes } from './modules/uploads/routes';
import {
  UploadService,
  type UploadObjectStorage,
} from './modules/uploads/services/upload.service';
import { registerAdminRoutes } from './modules/admin/routes';
import { UserAdministrationService } from './modules/admin/services/user-administration.service';
import { s3UploadObjectStorage } from './storage/s3';
import { startToolApprovalRecovery } from './agent/approval-recovery';
import { configureAgentRuntime } from './agent/runtime-manager';

export type BuildApiOptions = {
  config?: ApiConfig;
  objectStorage?: UploadObjectStorage;
};

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

  const authService = new AuthService(db, config);
  const auth = new AuthModule(authService, config.sessionCookie);
  registerAuthRoutes(app, auth, authService);
  registerChatRoutes(app, auth, new ChatService(db, {
    onSessionCleanupError(error, sessionId) {
      app.log.warn({ err: error, sessionId }, 'Unable to delete JSONL session');
    },
  }));
  registerConfigurationRoutes(
    app,
    auth,
    new ProviderConfigurationService(db),
    new RuntimeConfigurationService(db),
  );
  registerMcpRoutes(app, auth, new McpServerService(db));
  registerTelemetryRoutes(app, auth, new TelemetryQueryService(db));
  registerUploadRoutes(
    app,
    auth,
    new UploadService(db, options.objectStorage ?? s3UploadObjectStorage),
  );
  registerAdminRoutes(app, auth, new UserAdministrationService(db));

  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
