import { PassThrough } from 'node:stream';

import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import { ApiError } from '../../http/errors';
import {
  classroomDiscussionParamsSchema,
  classroomDiscussionRoundSchema,
  createClassroomDiscussionSchema,
  currentClassroomDiscussionSchema,
} from './schemas';
import type { ClassroomDiscussionService } from './services/classroom-discussion.service';

function sse(type: string, data: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: message,
    code: error instanceof ApiError ? error.code : 'CLASSROOM_DISCUSSION_STREAM_FAILED',
    retryable: !(error instanceof ApiError) || error.statusCode >= 500,
  };
}

export function registerClassroomDiscussionRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  discussions: ClassroomDiscussionService,
) {
  app.post('/classroom-discussions', async (request, reply) => {
    const user = await auth.requireUser(request);
    const input = createClassroomDiscussionSchema.parse(request.body);
    const result = await discussions.createOrResume(user.id, {
      target: { kind: input.kind, id: input.id },
      sceneId: input.sceneId,
      topic: input.topic,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      ...(input.triggerAgentId ? { triggerAgentId: input.triggerAgentId } : {}),
      ...(input.entryCursor ? { entryCursor: input.entryCursor } : {}),
    });
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.get('/classroom-discussions/current', async (request) => {
    const user = await auth.requireUser(request);
    const input = currentClassroomDiscussionSchema.parse(request.query);
    return discussions.getCurrent(
      user.id,
      { kind: input.kind, id: input.id },
      input.sceneId,
    );
  });

  app.get('/classroom-discussions/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = classroomDiscussionParamsSchema.parse(request.params);
    return discussions.get(user.id, id);
  });

  app.post('/classroom-discussions/:id/abort', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = classroomDiscussionParamsSchema.parse(request.params);
    await discussions.abortRound(user.id, id);
    return { ok: true };
  });

  app.post('/classroom-discussions/:id/complete', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = classroomDiscussionParamsSchema.parse(request.params);
    return discussions.complete(user.id, id);
  });

  app.post('/classroom-discussions/:id/rounds/stream', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { id } = classroomDiscussionParamsSchema.parse(request.params);
    const input = classroomDiscussionRoundSchema.parse(request.body ?? {});
    const run = await discussions.createRound(user.id, id, input);

    const stream = new PassThrough();
    reply.headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.send(stream);

    let closed = false;
    const send = (type: string, data: unknown) => {
      if (!closed && !stream.destroyed) stream.write(sse(type, data));
    };
    const abort = () => {
      if (!closed) run.abort();
    };
    request.raw.once('aborted', abort);
    stream.once('close', abort);

    void run.start((event) => send(event.type, event))
      .catch((error: unknown) => send('error', streamError(error)))
      .finally(() => {
        closed = true;
        request.raw.removeListener('aborted', abort);
        stream.removeListener('close', abort);
        if (!stream.destroyed) stream.end();
      });
    return reply;
  });
}
