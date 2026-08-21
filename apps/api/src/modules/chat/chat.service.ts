import {
  UnsupportedThinkingLevelError,
  type AgentRuntimeEvent,
  type ModelSelection,
  type RuntimeRunResult,
} from '@chalk/agent-runtime';
import type { ImageContent } from '@earendil-works/pi-ai';

import {
  closeRuntime,
  createUserModelCatalog,
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
  model?: ModelSelection;
  attachmentIds: string[];
};

export type ChatMessageRun = {
  abort(): void;
  start(listener: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<RuntimeRunResult>;
  complete(): Promise<void>;
};

const titleModel = { providerId: 'deepseek', modelId: 'deepseek-v4-flash' } as const;
const titlePrompt = [
  '你为数学学习产品生成会话标题。',
  '只根据用户的第一条问题，生成一个简洁、具体的中文标题。',
  '标题应描述知识点或学习任务，不给答案，不复述整段问题，不使用引号、序号或句号。',
  '优先控制在 8 到 18 个汉字；只输出标题本身。',
].join('\n');

function fallbackTitle(message: string) {
  const trimmed = message.trim();
  const firstSentence = trimmed.split(/[。！？!?\r\n]/, 1)[0]?.trim();
  return (firstSentence || trimmed).slice(0, 80);
}

function generatedTitle(content: Array<{ type: string; text?: string }>) {
  const raw = content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^(?:标题|会话标题)\s*[:：]\s*/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  return raw.length >= 2 ? raw.slice(0, 40) : null;
}

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
      await deleteSession(userId, session.descriptor.id).catch(() => undefined);
      throw error;
    }
  }

  getConversation(userId: string, conversationId: string) {
    return this.conversations.getById(userId, conversationId);
  }

  renameConversation(userId: string, conversationId: string, title: string) {
    return this.conversations.update(userId, conversationId, {
      title,
      titleSource: 'manual',
    });
  }

  private async generateAutoTitle(userId: string, conversationId: string, message: string) {
    const catalog = await createUserModelCatalog(userId);
    const model = await catalog.resolve(titleModel);
    const response = await catalog.getRawModels().completeSimple(
      model,
      {
        systemPrompt: titlePrompt,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: message }],
          timestamp: Date.now(),
        }],
      },
      {
        maxTokens: 48,
        maxRetries: 0,
        timeoutMs: 8_000,
      },
    );
    const title = generatedTitle(response.content);
    if (title) await this.conversations.updateAutoTitle(userId, conversationId, title);
  }

  async deleteConversation(userId: string, conversationId: string) {
    const conversation = await this.conversations.getById(userId, conversationId);
    await closeRuntime(conversationId);
    await this.conversations.delete(userId, conversationId);

    // Postgres is the owner-visible source of truth. Failed transcript cleanup is
    // recoverable and should not resurrect a conversation that was already deleted.
    await deleteSession(userId, conversation.sessionId).catch((error) => {
      this.options.onSessionCleanupError?.(error, conversation.sessionId);
    });
  }

  async getMessages(userId: string, conversationId: string) {
    const conversation = await this.conversations.getById(userId, conversationId);
    const session = await openSession(userId, conversation.sessionId);
    return session.getTranscript();
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
    if (!conversation.title) {
      const initialized = await this.conversations.initializeFallbackTitle(
        userId,
        conversationId,
        fallbackTitle(input.message),
      );
      if (initialized) {
        void this.generateAutoTitle(userId, conversationId, input.message).catch(() => undefined);
      }
    }
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
    let entry;
    try {
      entry = await getOrCreateRuntime(userId, conversation, input.model);
    } catch (error) {
      if (error instanceof UnsupportedThinkingLevelError) {
        throw new ApiError(400, error.message, 'UNSUPPORTED_THINKING_LEVEL');
      }
      throw error;
    }

    return {
      abort: () => entry.runtime.abort(),
      start: (listener) => entry.runtime.run(prompt, listener, images),
      complete: async () => {
        await this.conversations.update(userId, conversationId, {});
      },
    };
  }
}
