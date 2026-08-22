import { PassThrough } from 'node:stream';

import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import type { ChatService } from './services/chat.service';
import {
  chatStreamSchema,
  conversationListQuerySchema,
  conversationParamsSchema,
  createConversationSchema,
  renameConversationSchema,
  steerRunSchema,
  toolDecisionSchema,
} from './schemas';

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

export function registerChatRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  chat: ChatService,
) {
  app.get('/chat', async (request) => {
    const user = await auth.requireUser(request);
    const query = conversationListQuerySchema.parse(request.query);
    return {
      conversations: await chat.listConversations(user.id, query.limit, query.offset),
    };
  });

  app.post('/chat', async (request, reply) => {
    const user = await auth.requireUser(request);
    const conversation = await chat.createConversation(
      user.id,
      createConversationSchema.parse(request.body ?? {}),
    );
    return reply.code(201).send({ conversation });
  });

  app.get('/chat/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = conversationParamsSchema.parse(request.params);
    return { conversation: await chat.getConversation(user.id, id) };
  });

  app.patch('/chat/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = conversationParamsSchema.parse(request.params);
    const { title } = renameConversationSchema.parse(request.body);
    return { conversation: await chat.renameConversation(user.id, id, title) };
  });

  app.delete('/chat/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = conversationParamsSchema.parse(request.params);
    await chat.deleteConversation(user.id, id);
    return { ok: true };
  });

  app.get('/chat/:id/messages', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = conversationParamsSchema.parse(request.params);
    return { messages: await chat.getMessages(user.id, id) };
  });

  app.post('/chat/:id/abort', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = conversationParamsSchema.parse(request.params);
    await chat.abortRun(user.id, id);
    return { ok: true };
  });

  app.post('/chat/:id/steer', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = conversationParamsSchema.parse(request.params);
    const input = steerRunSchema.parse(request.body);
    await chat.steerRun(user.id, id, input.message);
    return { ok: true };
  });

  app.post('/chat/:id/approve', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = conversationParamsSchema.parse(request.params);
    const input = toolDecisionSchema.parse(request.body);
    await chat.decideTool(user.id, id, input.toolCallId, input.approved);
    return { ok: true };
  });

  app.post('/chat/:id/stream', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { id } = conversationParamsSchema.parse(request.params);
    const run = await chat.createMessageRun(user.id, id, chatStreamSchema.parse(request.body));

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
