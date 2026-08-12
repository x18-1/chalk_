import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthModule } from '../../auth/auth-module';
import { getDb } from '../../db/client';
import { createAttachmentsDal, createConversationsDal } from '../../db/dal';
import { ApiError } from '../../http/errors';
import {
  closeRuntime,
  createSession,
  deleteSession,
  getActiveRuntime,
  getOrCreateRuntime,
  openSession,
} from '../../agent/runtime-manager';
import { readUploadedObject } from '../../storage/s3';
import type { ImageContent } from '@earendil-works/pi-ai';

const idParams = z.object({ id: z.string().uuid() });
const createSchema = z.object({ title: z.string().trim().min(1).max(160).optional() });
const updateSchema = z.object({ title: z.string().trim().min(1).max(160) });
const modelSchema = z.object({ providerId: z.string().min(1).max(100), modelId: z.string().min(1).max(200) });
const streamSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  model: modelSchema.optional(),
  attachmentIds: z.array(z.string().uuid()).max(4).default([]),
});

function sse(type: string, data: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function registerChatRoutes(app: FastifyInstance, auth: AuthModule) {
  app.get('/chat', async (request) => {
    const user = await auth.requireUser(request);
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);
    return { conversations: await createConversationsDal(getDb()).list(user.id, query.limit, query.offset) };
  });

  app.post('/chat', async (request, reply) => {
    const user = await auth.requireUser(request);
    const input = createSchema.parse(request.body ?? {});
    const session = await createSession(user.id);
    try {
      const conversation = await createConversationsDal(getDb()).create(user.id, {
        title: input.title,
        sessionId: session.descriptor.id,
        sessionFilePath: session.descriptor.path,
      });
      return reply.code(201).send({ conversation });
    } catch (error) {
      await deleteSession(session.descriptor.id).catch(() => undefined);
      throw error;
    }
  });

  app.get('/chat/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    return { conversation: await createConversationsDal(getDb()).getById(user.id, id) };
  });

  app.patch('/chat/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    return { conversation: await createConversationsDal(getDb()).update(user.id, id, updateSchema.parse(request.body)) };
  });

  app.delete('/chat/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const dal = createConversationsDal(getDb());
    const conversation = await dal.getById(user.id, id);
    await closeRuntime(id);
    await dal.delete(user.id, id);
    // The JSONL transcript is deliberately separate from Postgres. An orphaned file
    // is recoverable by a maintenance job, while deleting the DB record first keeps
    // the owner-visible business state consistent if the filesystem is unavailable.
    await deleteSession(conversation.sessionId).catch((error) => {
      request.log.warn({ err: error, sessionId: conversation.sessionId }, 'Unable to delete JSONL session');
    });
    return { ok: true };
  });

  app.get('/chat/:id/messages', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const conversation = await createConversationsDal(getDb()).getById(user.id, id);
    const session = await openSession(conversation.sessionId);
    if (session.descriptor.ownerId && session.descriptor.ownerId !== user.id) {
      throw new ApiError(404, 'Resource not found', 'NOT_FOUND');
    }
    return { messages: await session.getMessages() };
  });

  app.post('/chat/:id/abort', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    await createConversationsDal(getDb()).getById(user.id, id);
    getActiveRuntime(id)?.runtime.abort();
    return { ok: true };
  });

  app.post('/chat/:id/steer', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const input = z.object({ message: z.string().trim().min(1).max(20_000) }).parse(request.body);
    await createConversationsDal(getDb()).getById(user.id, id);
    const runtime = getActiveRuntime(id);
    if (!runtime) throw new ApiError(409, 'No active run', 'NO_ACTIVE_RUN');
    runtime.runtime.steer(input.message);
    return { ok: true };
  });

  app.post('/chat/:id/approve', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const input = z.object({ toolCallId: z.string().min(1).max(200), approved: z.boolean() }).parse(request.body);
    await createConversationsDal(getDb()).getById(user.id, id);
    const runtime = getActiveRuntime(id);
    if (!runtime) throw new ApiError(409, 'No active run', 'NO_ACTIVE_RUN');
    await runtime.approvals.decide(id, input.toolCallId, input.approved, input.approved ? undefined : '学生拒绝了这次工具调用');
    return { ok: true };
  });

  app.post('/chat/:id/stream', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const input = streamSchema.parse(request.body);
    const db = getDb();
    const conversation = await createConversationsDal(db).getById(user.id, id);
    const attachments = await createAttachmentsDal(db).listForConversation(user.id, id, input.attachmentIds);
    if (attachments.some((attachment) => attachment.status !== 'ready')) {
      throw new ApiError(409, 'One or more attachments have not finished uploading', 'ATTACHMENT_NOT_READY');
    }

    const images: ImageContent[] = [];
    for (const attachment of attachments) {
      if (!attachment.contentType.startsWith('image/')) continue;
      const data = await readUploadedObject(attachment.fileKey);
      images.push({ type: 'image', data: data.toString('base64'), mimeType: attachment.contentType });
    }
    const documents = attachments.filter((attachment) => attachment.contentType === 'application/pdf');
    const prompt = documents.length
      ? `${input.message}\n\n已附加文件：${documents.map((attachment) => attachment.filename).join('、')}。当前版本不会自动读取 PDF 正文，请根据学生提供的文字继续，并在需要正文时明确询问。`
      : input.message;
    const entry = await getOrCreateRuntime(user.id, conversation, input.model);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    const send = (type: string, data: unknown) => {
      if (!closed && !reply.raw.destroyed) reply.raw.write(sse(type, data));
    };
    const abort = () => {
      if (!closed) entry.runtime.abort();
    };
    request.raw.once('aborted', abort);
    reply.raw.once('close', abort);

    void entry.runtime.run(prompt, (event) => send(event.type, event), images)
      .then(async (result) => {
        if (!closed) {
          await createConversationsDal(db).update(user.id, id, {
            title: conversation.title ?? input.message.slice(0, 80),
          });
          send('result', result);
        }
      })
      .catch((error: unknown) => {
        send('error', { error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        closed = true;
        request.raw.removeListener('aborted', abort);
        reply.raw.removeListener('close', abort);
        if (!reply.raw.destroyed) reply.raw.end();
      });
  });
}
