import { PassThrough } from 'node:stream';

import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import {
  classroomGenerationRunParamsSchema,
  confirmClassroomOutlineRevisionSchema,
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

  app.get('/classroom-generation-runs/:runId/outline-events', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    const run = await generation.getRun(user.id, runId);
    if (run.stage !== 'outline') return reply.code(404).send({ error: 'Outline run not found', code: 'NOT_FOUND' });
    const afterId = parseLastEventId(request.headers['last-event-id']);
    const stream = new PassThrough();
    reply.headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.send(stream);

    let closed = false;
    let cursor = afterId;
    const close = () => {
      closed = true;
    };
    request.raw.once('aborted', close);
    stream.once('close', close);
    const heartbeat = setInterval(() => {
      if (!closed && !stream.destroyed) stream.write(':heartbeat\n\n');
    }, 15_000);
    heartbeat.unref();

    void (async () => {
      try {
        while (!closed) {
          const events = await generation.listOutlineEvents(user.id, runId, cursor);
          for (const event of events) {
            cursor = event.id;
            if (!stream.destroyed) stream.write(outlineSse(event.id, event.data));
          }
          if (events.some((event) => event.type === 'done' || event.type === 'error')) break;
          const latest = await generation.getRun(user.id, runId);
          if (['completed', 'failed', 'aborted'].includes(latest.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } finally {
        clearInterval(heartbeat);
        request.raw.removeListener('aborted', close);
        stream.removeListener('close', close);
        if (!stream.destroyed) stream.end();
      }
    })();
    return reply;
  });

  app.post('/classroom-generation-runs/:runId/retry', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    return reply.code(202).send({ generationRun: await generation.retryRun(user.id, runId) });
  });

  app.post('/classroom-generation-runs/:runId/outline-revisions', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { runId } = classroomGenerationRunParamsSchema.parse(request.params);
    const input = confirmClassroomOutlineRevisionSchema.parse(request.body);
    const confirmed = await generation.confirmOutlineRevision(user.id, runId, input);
    return reply.code(confirmed.created ? 202 : 200).send(confirmed);
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

function parseLastEventId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function outlineSse(id: number, data: unknown) {
  return `id: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
}
