import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import {
  classroomGenerationRunParamsSchema,
  createClassroomGenerationRunSchema,
  createClassroomMediaTasksRunSchema,
} from './schemas';
import type { ClassroomGenerationService } from './services/classroom-generation.service';

export function registerClassroomGenerationRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  generation: ClassroomGenerationService,
) {
  app.post('/classroom-generation-runs', async (request, reply) => {
    const user = await auth.requireUser(request);
    const run = await generation.createOutlineRun(user.id, createClassroomGenerationRunSchema.parse(request.body));
    return reply.code(202).send({ generationRun: run });
  });

  app.get('/classroom-generation-runs/current', async (request) => {
    const user = await auth.requireUser(request);
    return { generationRun: await generation.getCurrentRun(user.id) };
  });

  app.get('/classroom-generation-runs/:runId', async (request) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    return { generationRun: await generation.getRun(user.id, runId) };
  });

  app.post('/classroom-generation-runs/:runId/retry', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    return reply.code(202).send({ generationRun: await generation.retryRun(user.id, runId) });
  });

  app.post('/classroom-generation-runs/:runId/scene-content', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    return reply.code(202).send({ generationRun: await generation.createSceneContentRun(user.id, runId) });
  });

  app.post('/classroom-generation-runs/:runId/scene-actions', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    return reply.code(202).send({ generationRun: await generation.createSceneActionsRun(user.id, runId) });
  });

  app.post('/classroom-generation-runs/:runId/media-tasks', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    const input = createClassroomMediaTasksRunSchema.parse(request.body);
    return reply.code(202).send({ generationRun: await generation.createMediaTasksRun(user.id, runId, input) });
  });

  app.post('/classroom-generation-runs/:runId/publish', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    const published = await generation.publishRun(user.id, runId);
    return reply.code(published.created ? 201 : 200).send(published);
  });

  app.post('/classroom-generation-runs/:runId/abort', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    return reply.code(202).send({ generationRun: await generation.abortRun(user.id, runId) });
  });
}
