import { ApiRequestError, apiJson, apiUrl } from './client';

export type Conversation = {
  id: string;
  title: string | null;
  titleSource: 'fallback' | 'auto' | 'manual';
  sessionId: string;
  createdAt: string;
  updatedAt: string;
};

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ModelRef = { providerId: string; modelId: string };
export type ModelSelection = ModelRef & { thinkingLevel: ThinkingLevel };
export type ChatModel = { providerId: string; id: string; name: string };
export type ChatMessage = Record<string, unknown>;
export type CompletedChatMessage = { role?: unknown; content?: unknown; stopReason?: unknown };
export type ChatStreamInput = {
  message: string;
  model?: ModelSelection;
  attachmentIds?: string[];
};
export type ChatStreamEvent = { type: string; data: Record<string, unknown> & { message?: CompletedChatMessage } };

function conversationPath(id?: string) {
  return id ? `/chat/${encodeURIComponent(id)}` : '/chat';
}

async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consumeChunk = (chunk: string) => {
    const event = chunk.match(/^event: ([^\n]+)\ndata: ([\s\S]+)$/);
    if (!event) return;
    try {
      onEvent({ type: event[1]!, data: JSON.parse(event[2]!) as ChatStreamEvent['data'] });
    } catch {
      // Ignore malformed keep-alive chunks; the stream can continue.
    }
  };

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) consumeChunk(chunk);
  }
  if (buffer.trim()) consumeChunk(buffer);
}

export const chatApi = {
  list() {
    return apiJson<{ conversations: Conversation[] }>('/chat');
  },

  create() {
    return apiJson<{ conversation: Conversation }>('/chat', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  get(id: string) {
    return apiJson<{ conversation: Conversation }>(conversationPath(id));
  },

  messages(id: string) {
    return apiJson<{ messages: ChatMessage[] }>(`${conversationPath(id)}/messages`);
  },

  rename(id: string, title: string) {
    return apiJson<{ conversation: Conversation }>(conversationPath(id), {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },

  delete(id: string) {
    return apiJson<{ ok: true }>(conversationPath(id), { method: 'DELETE' });
  },

  abort(id: string) {
    return apiJson<{ ok: true }>(`${conversationPath(id)}/abort`, { method: 'POST' });
  },

  approve(id: string, toolCallId: string, approved: boolean) {
    return apiJson<{ ok: true }>(`${conversationPath(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ toolCallId, approved }),
    });
  },

  steer(id: string, message: string) {
    return apiJson<{ ok: true }>(`${conversationPath(id)}/steer`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  async stream(
    id: string,
    input: ChatStreamInput,
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ) {
    const response = await fetch(apiUrl(`${conversationPath(id)}/stream`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      throw new ApiRequestError(
        response.status,
        body.error ?? '对话请求失败',
        body.code,
      );
    }
    await consumeEventStream(response.body, onEvent);
  },
};
