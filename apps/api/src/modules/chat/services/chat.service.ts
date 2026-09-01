import {
  type AgentRuntimeEvent,
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
} from '../../../agent/runtime-manager';
import type { Database } from '../../../db/client';
import { createAttachmentsDal, createConversationsDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import {
  UnsupportedThinkingLevelError,
  type ModelSelection,
} from '../../../providers/llm/model-catalog';
import { readUploadedObject } from '../../../storage/s3';
import { PROMPT_IDS, buildPrompt } from '../../../prompts';
import type { MemoryService } from '../../memory/services/memory.service';
import type { KnowledgeBaseQueryer } from '../../../agent/tools/knowledge-base-search';

export type ChatStreamInput = {
  message: string;
  model?: ModelSelection;
  attachmentIds: string[];
  knowledgeBaseId?: string;
};

export type ChatMessageRun = {
  abort(): void;
  start(listener: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<RuntimeRunResult>;
  complete(): Promise<void>;
};

const titleModel = { providerId: 'deepseek', modelId: 'deepseek-v4-flash' } as const;

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

function boundedMessagePayload(message: unknown) {
  if (!message || typeof message !== 'object') return null;
  const candidate = message as { role?: unknown; content?: unknown };
  const content = Array.isArray(candidate.content)
    ? candidate.content.filter((part): part is { type?: unknown; text?: unknown } => !!part && typeof part === 'object')
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string).join('')
    : typeof candidate.content === 'string' ? candidate.content : '';
  return { role: typeof candidate.role === 'string' ? candidate.role : 'assistant', content: content.slice(0, 8_000) };
}

type ChatServiceOptions = {
  onSessionCleanupError?: (error: unknown, sessionId: string) => void;
  memory?: MemoryService;
  knowledgeBaseQueryer?: KnowledgeBaseQueryer;
};

export class ChatService {
  private readonly conversations;
  private readonly attachments;
  private readonly memory?: MemoryService;

  constructor(
    db: Database,
    private readonly options: ChatServiceOptions = {},
  ) {
    this.conversations = createConversationsDal(db);
    this.attachments = createAttachmentsDal(db);
    this.memory = options.memory;
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
    const titlePrompt = buildPrompt(PROMPT_IDS.CONVERSATION_TITLE, {});
    const response = await catalog.completeSimple(
      titleModel,
      {
        systemPrompt: titlePrompt.system,
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
    await deleteSession(userId, conversation.sessionId, conversation.sessionFilePath).catch((error) => {
      this.options.onSessionCleanupError?.(error, conversation.sessionId);
    });
  }

  async getMessages(userId: string, conversationId: string) {
    const conversation = await this.conversations.getById(userId, conversationId);
    const session = await openSession(userId, conversation.sessionId, conversation.sessionFilePath);
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
    if (input.knowledgeBaseId && !this.options.knowledgeBaseQueryer) {
      throw new ApiError(503, 'Knowledge base search is temporarily unavailable', 'RAG_SIDECAR_UNAVAILABLE');
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
      entry = await getOrCreateRuntime(userId, conversation, input.model, {
        ...(input.knowledgeBaseId ? { knowledgeBaseId: input.knowledgeBaseId } : {}),
        ...(this.options.knowledgeBaseQueryer ? { knowledgeBaseQueryer: this.options.knowledgeBaseQueryer } : {}),
      });
    } catch (error) {
      if (error instanceof UnsupportedThinkingLevelError) {
        throw new ApiError(400, error.message, 'UNSUPPORTED_THINKING_LEVEL');
      }
      throw error;
    }

    return {
      abort: () => entry.runtime.abort(),
      start: async (listener) => {
        if (this.memory) {
          const memoryPrompt = await this.memory.promptContext(userId).catch(() => '');
          entry.runtime.setSystemPrompt(memoryPrompt ? `${entry.systemPrompt}\n\n${memoryPrompt}` : entry.systemPrompt);
        }
        await this.memory?.appendEvent(userId, {
          surface: 'chat',
          kind: 'message',
          payload: { role: 'user', content: input.message, conversationId },
          sourceType: 'conversation',
          sourceId: conversationId,
        }).catch(() => undefined);
        const result = await entry.runtime.run(prompt, listener, images);
        if (result.status === 'completed') {
          await this.memory?.appendEvent(userId, {
            surface: 'chat',
            kind: 'response',
            payload: { message: boundedMessagePayload(result.message), conversationId },
            sourceType: 'conversation',
            sourceId: conversationId,
          }).catch(() => undefined);
        }
        return result;
      },
      complete: async () => {
        await this.conversations.update(userId, conversationId, {});
      },
    };
  }
}
