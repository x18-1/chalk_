import { PassThrough } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MODEL_THINKING_LEVELS } from '@chalk/agent-runtime';

import type { AuthModule } from '../../auth/auth-module';
import { getDb } from '../../db/client';
import { ChatService } from './chat.service';

const idParams = z.object({ id: z.string().uuid() });
const createSchema = z.object({ title: z.string().trim().min(1).max(160).optional() });
const updateSchema = z.object({ title: z.string().trim().min(1).max(160) });
const modelSchema = z.object({
  providerId: z.string().min(1).max(100),
  modelId: z.string().min(1).max(200),
  thinkingLevel: z.enum(MODEL_THINKING_LEVELS),
});
const streamSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  model: modelSchema.optional(),
  attachmentIds: z.array(z.string().uuid()).max(4).default([]),
});

function sse(type: string, data: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

type StreamErrorCategory = 'provider' | 'tool' | 'mcp' | 'approval' | 'network';

function streamError(error: unknown, fallback: StreamErrorCategory = 'network') {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
  const haystack = `${error instanceof Error ? error.name : ''} ${code ?? ''} ${message}`.toLowerCase();
  const category: StreamErrorCategory = haystack.includes('mcp')
    ? 'mcp'
    : haystack.includes('approval') || haystack.includes('approve')
      ? 'approval'
      : haystack.includes('tool')
        ? 'tool'
        : haystack.includes('provider') || haystack.includes('model') || haystack.includes('credential') || haystack.includes('api key')
          ? 'provider'
          : fallback;
  return {
    error: message,
    code: code ?? `STREAM_${category.toUpperCase()}_ERROR`,
    category,
    retryable: category !== 'approval',
  };
}

export function registerChatRoutes(app: FastifyInstance, auth: AuthModule) {
  const chat = new ChatService(getDb(), {
    onSessionCleanupError(error, sessionId) {
      app.log.warn({ err: error, sessionId }, 'Unable to delete JSONL session');
    },
  });

  app.get('/chat', async (request) => {
    const user = await auth.requireUser(request);
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);
    return {
      conversations: await chat.listConversations(user.id, query.limit, query.offset),
    };
  });

  app.post('/chat', async (request, reply) => {
    const user = await auth.requireUser(request);
    const conversation = await chat.createConversation(
      user.id,
      createSchema.parse(request.body ?? {}),
    );
    return reply.code(201).send({ conversation });
  });

  app.get('/chat/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    return { conversation: await chat.getConversation(user.id, id) };
  });

  app.patch('/chat/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const { title } = updateSchema.parse(request.body);
    return { conversation: await chat.renameConversation(user.id, id, title) };
  });

  app.delete('/chat/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    await chat.deleteConversation(user.id, id);
    return { ok: true };
  });

  app.get('/chat/:id/messages', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    return { messages: await chat.getMessages(user.id, id) };
  });

  app.post('/chat/:id/abort', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    await chat.abortRun(user.id, id);
    return { ok: true };
  });

  app.post('/chat/:id/steer', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const input = z.object({
      message: z.string().trim().min(1).max(20_000),
    }).parse(request.body);
    await chat.steerRun(user.id, id, input.message);
    return { ok: true };
  });

  app.post('/chat/:id/approve', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const input = z.object({
      toolCallId: z.string().min(1).max(200),
      approved: z.boolean(),
    }).parse(request.body);
    await chat.decideTool(user.id, id, input.toolCallId, input.approved);
    return { ok: true };
  });

  app.post('/chat/:id/stream', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const run = await chat.createMessageRun(user.id, id, streamSchema.parse(request.body));

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
      .then(async (result) => {
        if (!closed) {
          await run.complete();
          if (result.status === 'failed') {
            send('error', streamError(result.error ?? 'Provider failed to complete the response', 'provider'));
          } else {
            send('result', result);
          }
        }
      })
      .catch((error: unknown) => {
        send('error', streamError(error));
      })
      .finally(() => {
        closed = true;
        request.raw.removeListener('aborted', abort);
        stream.removeListener('close', abort);
        if (!stream.destroyed) stream.end();
      });
    return reply;
  });
}
