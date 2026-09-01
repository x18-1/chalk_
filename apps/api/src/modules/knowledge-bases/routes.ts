import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import {
  createKnowledgeBaseSchema,
  knowledgeBaseIdParamsSchema,
  knowledgeDocumentParamsSchema,
  prepareKnowledgeDocumentSchema,
  queryKnowledgeBaseSchema,
} from './schemas';
import type { KnowledgeBaseService } from './services/knowledge-base.service';

export function registerKnowledgeBaseRoutes(app: FastifyInstance, auth: AuthModule, service: KnowledgeBaseService) {
  app.get('/knowledge-bases', async (request) => {
    const user = await auth.requireUser(request);
    return { knowledgeBases: await service.list(user.id) };
  });

  app.post('/knowledge-bases', async (request, reply) => {
    const user = await auth.requireUser(request);
    return reply.code(201).send({ knowledgeBase: await service.create(user.id, createKnowledgeBaseSchema.parse(request.body)) });
  });

  app.get('/knowledge-bases/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = knowledgeBaseIdParamsSchema.parse(request.params);
    return { knowledgeBase: await service.get(user.id, id) };
  });

  app.post('/knowledge-bases/:id/documents/presign', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = knowledgeBaseIdParamsSchema.parse(request.params);
    return service.prepareDocument(user.id, id, prepareKnowledgeDocumentSchema.parse(request.body));
  });

  app.post('/knowledge-bases/:id/documents/:documentId/confirm', async (request, reply) => {
    const user = await auth.requireUser(request);
    const params = knowledgeDocumentParamsSchema.parse(request.params);
    return reply.code(202).send({ document: await service.confirmDocument(user.id, params.id, params.documentId) });
  });

  app.post('/knowledge-bases/:id/documents/:documentId/reindex', async (request, reply) => {
    const user = await auth.requireUser(request);
    const params = knowledgeDocumentParamsSchema.parse(request.params);
    return reply.code(202).send({ document: await service.confirmDocument(user.id, params.id, params.documentId, { reindex: true }) });
  });

  app.post('/knowledge-bases/:id/query', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = knowledgeBaseIdParamsSchema.parse(request.params);
    return service.query(user.id, id, queryKnowledgeBaseSchema.parse(request.body));
  });

  app.get('/knowledge-bases/:id/documents/:documentId/chunks', async (request) => {
    const user = await auth.requireUser(request);
    const params = knowledgeDocumentParamsSchema.parse(request.params);
    return service.chunks(user.id, params.id, params.documentId);
  });
}
