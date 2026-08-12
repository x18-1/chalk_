import type { AgentRuntimeEvent, ModelRef, RuntimeRunResult } from '@chalk/agent-runtime';
import type { ImageContent } from '@earendil-works/pi-ai';

import {
  closeRuntime,
  createSession,
  deleteSession,
  getActiveRuntime,
  getOrCreateRuntime,
  openSession,
} from '../../agent/runtime-manager';
import type { Database } from '../../db/client';
import { createAttachmentsDal, createConversationsDal } from '../../db/dal';
import { ApiError } from '../../http/errors';
import { readUploadedObject } from '../../storage/s3';

export type ChatStreamInput = {
  message: string;
  model?: ModelRef;
  attachmentIds: string[];
};

export type ChatMessageRun = {
  abort(): void;
  start(listener: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<RuntimeRunResult>;
  complete(): Promise<void>;
};

type ChatServiceOptions = {
  onSessionCleanupError?: (error: unknown, sessionId: string) => void;
};

export class ChatService {
  private readonly conversations;
  private readonly attachments;

  constructor(
    db: Database,
    private readonly options: ChatServiceOptions = {},
  ) {
    this.conversations = createConversationsDal(db);
    this.attachments = createAttachmentsDal(db);
  }

  listConversations(userId: string, limit: number, offset: number) {
    return this.conversations.list(userId, limit, offset);
  }

  async createConversation(userId: string, input: { title?: string }) {
    const session = await createSession(userId);
    try {
      return await this.conversations.create(userId, {
        title: input.title,
        sessionId: session.descriptor.id,
        sessionFilePath: session.descriptor.path,
      });
    } catch (error) {
      await deleteSession(session.descriptor.id).catch(() => undefined);
      throw error;
    }
  }

  getConversation(userId: string, conversationId: string) {
    return this.conversations.getById(userId, conversationId);
  }

  renameConversation(userId: string, conversationId: string, title: string) {
    return this.conversations.update(userId, conversationId, { title });
  }

  async deleteConversation(userId: string, conversationId: string) {
    const conversation = await this.conversations.getById(userId, conversationId);
    await closeRuntime(conversationId);
    await this.conversations.delete(userId, conversationId);

    // Postgres is the owner-visible source of truth. Failed transcript cleanup is
    // recoverable and should not resurrect a conversation that was already deleted.
    await deleteSession(conversation.sessionId).catch((error) => {
      this.options.onSessionCleanupError?.(error, conversation.sessionId);
    });
  }

  async getMessages(userId: string, conversationId: string) {
    const conversation = await this.conversations.getById(userId, conversationId);
    const session = await openSession(conversation.sessionId);
    if (session.descriptor.ownerId && session.descriptor.ownerId !== userId) {
      throw new ApiError(404, 'Resource not found', 'NOT_FOUND');
    }
    return session.getMessages();
  }

  async abortRun(userId: string, conversationId: string) {
    await this.conversations.getById(userId, conversationId);
    getActiveRuntime(conversationId)?.runtime.abort();
  }

  async steerRun(userId: string, conversationId: string, message: string) {
    await this.conversations.getById(userId, conversationId);
    const runtime = getActiveRuntime(conversationId);
    if (!runtime) throw new ApiError(409, 'No active run', 'NO_ACTIVE_RUN');
    runtime.runtime.steer(message);
  }

  async decideTool(
    userId: string,
    conversationId: string,
    toolCallId: string,
    approved: boolean,
  ) {
    await this.conversations.getById(userId, conversationId);
    const runtime = getActiveRuntime(conversationId);
    if (!runtime) throw new ApiError(409, 'No active run', 'NO_ACTIVE_RUN');
    await runtime.approvals.decide(
      conversationId,
      toolCallId,
      approved,
      approved ? undefined : '学生拒绝了这次工具调用',
    );
  }

  async createMessageRun(
    userId: string,
    conversationId: string,
    input: ChatStreamInput,
  ): Promise<ChatMessageRun> {
    const conversation = await this.conversations.getById(userId, conversationId);
    const attachments = await this.attachments.listForConversation(
      userId,
      conversationId,
      input.attachmentIds,
    );
    if (attachments.some((attachment) => attachment.status !== 'ready')) {
      throw new ApiError(
        409,
        'One or more attachments have not finished uploading',
        'ATTACHMENT_NOT_READY',
      );
    }

    const images: ImageContent[] = [];
    for (const attachment of attachments) {
      if (!attachment.contentType.startsWith('image/')) continue;
      const data = await readUploadedObject(attachment.fileKey);
      images.push({
        type: 'image',
        data: data.toString('base64'),
        mimeType: attachment.contentType,
      });
    }

    const documents = attachments.filter(
      (attachment) => attachment.contentType === 'application/pdf',
    );
    const prompt = documents.length
      ? `${input.message}\n\n已附加文件：${documents.map((attachment) => attachment.filename).join('、')}。当前版本不会自动读取 PDF 正文，请根据学生提供的文字继续，并在需要正文时明确询问。`
      : input.message;
    const entry = await getOrCreateRuntime(userId, conversation, input.model);

    return {
      abort: () => entry.runtime.abort(),
      start: (listener) => entry.runtime.run(prompt, listener, images),
      complete: async () => {
        await this.conversations.update(userId, conversationId, {
          title: conversation.title ?? input.message.slice(0, 80),
        });
      },
    };
  }
}
