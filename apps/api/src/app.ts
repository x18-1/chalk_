import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';

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
import { CapabilityConfigurationService } from './modules/configuration/services/capability-configuration.service';
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
import { startToolApprovalRecovery } from './agent/approval-recovery';
import { configureAgentRuntime } from './agent/runtime-manager';
import { registerMediaRoutes } from './modules/media/routes';
import { MediaProviderService } from './modules/media/services/media-provider.service';
import { registerClassroomRoutes } from './modules/classrooms/routes';
import {
  ClassroomService,
  type ClassroomObjectStorage,
} from './modules/classrooms/services/classroom.service';
import { s3ClassroomObjectStorage } from './storage/s3';
import { validatePromptRegistry } from './prompts';
import { registerClassroomGenerationRoutes } from './modules/classroom-generation/routes';
import {
  ClassroomGenerationService,
  type ClassroomGenerationModel,
  type ClassroomGenerationWorkerOptions,
} from './modules/classroom-generation/services/classroom-generation.service';
import { piClassroomOutlineModel } from './providers/llm/classroom-outline-model';
import { registerLearningSessionRoutes } from './modules/learning-sessions/routes';
import { LearningSessionService } from './modules/learning-sessions/services/learning-session.service';
import { registerQuizAttemptRoutes } from './modules/quiz-attempts/routes';
import { QuizAttemptService } from './modules/quiz-attempts/services/quiz-attempt.service';
import { registerClassroomDiscussionRoutes } from './modules/classroom-discussions/routes';
import {
  ClassroomDiscussionService,
} from './modules/classroom-discussions/services/classroom-discussion.service';
import type { ClassroomDiscussionModel } from './modules/classroom-discussions/services/classroom-discussion.graph';
import { piClassroomDiscussionModel } from './providers/llm/classroom-discussion-model';
import { registerKnowledgeBaseRoutes } from './modules/knowledge-bases/routes';
import { KnowledgeBaseService, type KnowledgeObjectStorage } from './modules/knowledge-bases/services/knowledge-base.service';
import { createRagSidecarClient, type RagSidecarClient } from './modules/knowledge-bases/rag-sidecar-client';
import { s3UploadObjectStorage } from './storage/s3';

export type BuildApiOptions = {
  config?: ApiConfig;
  mediaEnvironment?: NodeJS.ProcessEnv;
  objectStorage?: UploadObjectStorage;
  knowledgeObjectStorage?: KnowledgeObjectStorage;
  ragSidecarClient?: RagSidecarClient;
  classroomObjectStorage?: ClassroomObjectStorage;
  classroomOutlineModel?: ClassroomGenerationModel;
  classroomMediaGenerator?: import('./modules/classroom-generation/services/classroom-generation.service').ClassroomMediaGenerator;
  classroomGenerationWorker?: ClassroomGenerationWorkerOptions;
  classroomDiscussionModel?: ClassroomDiscussionModel;
};

export async function buildApi(options: BuildApiOptions = {}): Promise<FastifyInstance> {
  validatePromptRegistry();
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: {
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 32 * 1_024 * 1_024,
  });

  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
      fileSize: 32 * 1_024 * 1_024,
    },
  });
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
  const knowledgeBases = new KnowledgeBaseService(
    db,
    options.knowledgeObjectStorage ?? s3UploadObjectStorage,
    options.ragSidecarClient ?? createRagSidecarClient({
      baseUrl: config.ragSidecarUrl,
      token: config.ragSidecarToken,
      timeoutMs: config.ragTimeoutMs,
    }),
  );
  registerChatRoutes(app, auth, new ChatService(db, {
    knowledgeBaseQueryer: knowledgeBases,
    onSessionCleanupError(error, sessionId) {
      app.log.warn({ err: error, sessionId }, 'Unable to delete JSONL session');
    },
  }));
  registerConfigurationRoutes(
    app,
    auth,
    new ProviderConfigurationService(db),
    new RuntimeConfigurationService(db),
    new CapabilityConfigurationService(db, options.mediaEnvironment),
  );
  registerMcpRoutes(app, auth, new McpServerService(db));
  registerTelemetryRoutes(app, auth, new TelemetryQueryService(db));
  registerUploadRoutes(
    app,
    auth,
    new UploadService(db, options.objectStorage ?? s3UploadObjectStorage),
  );
  registerKnowledgeBaseRoutes(app, auth, knowledgeBases);
  app.addHook('onClose', async () => knowledgeBases.stopWorker());
  const mediaProviders = new MediaProviderService(db, options.mediaEnvironment);
  registerMediaRoutes(app, auth, mediaProviders);
  registerClassroomRoutes(
    app,
    auth,
    new ClassroomService(db, options.classroomObjectStorage ?? s3ClassroomObjectStorage),
  );
  registerLearningSessionRoutes(app, auth, new LearningSessionService(db));
  registerQuizAttemptRoutes(app, auth, new QuizAttemptService(db));
  const classroomDiscussions = new ClassroomDiscussionService(
    db,
    options.classroomDiscussionModel ?? piClassroomDiscussionModel,
  );
  await classroomDiscussions.recoverInterrupted();
  registerClassroomDiscussionRoutes(app, auth, classroomDiscussions);
  const classroomGeneration = new ClassroomGenerationService(
    db,
    options.classroomOutlineModel ?? piClassroomOutlineModel,
    options.classroomMediaGenerator ?? {
      synthesize: (userId, input) => mediaProviders.synthesizeBinary(userId, input),
      generateImage: (userId, input) => mediaProviders.generateImageBinary(userId, input),
      async submitVideo(userId, input) {
        const submitted = await mediaProviders.submitVideo(userId, input);
        return {
          providerTaskId: submitted.providerTaskId,
          providerId: input.providerId,
          modelId: submitted.model ?? 'provider-default',
        };
      },
      pollVideo: (userId, input) => mediaProviders.pollVideoBinary(userId, input),
      cancelVideo: (userId, input) => mediaProviders.cancelVideo(userId, input),
    },
    options.classroomObjectStorage ?? s3ClassroomObjectStorage,
    {
      ...options.classroomGenerationWorker,
      onError(error) {
        app.log.error({ err: error }, 'Classroom generation worker failed');
        options.classroomGenerationWorker?.onError?.(error);
      },
    },
  );
  if (config.nodeEnv !== 'test' || options.classroomGenerationWorker) {
    classroomGeneration.startWorker();
    app.addHook('onClose', async () => classroomGeneration.stopWorker());
  }
  registerClassroomGenerationRoutes(
    app,
    auth,
    classroomGeneration,
  );
  registerAdminRoutes(app, auth, new UserAdministrationService(db));

  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
