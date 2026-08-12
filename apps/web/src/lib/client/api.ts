export type Conversation = {
  id: string;
  title: string | null;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
};

export type ModelRef = { providerId: string; modelId: string };

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function apiUrl(input: RequestInfo | URL) {
  if (input instanceof URL) return input.toString();
  if (typeof input !== 'string') return input;
  const path = input.startsWith('/api/') ? input.slice(4) : input;
  return path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(input), {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiRequestError(response.status, body.error ?? `Request failed (${response.status})`);
  return body;
}

export function formatConversationTitle(conversation: Conversation) {
  return conversation.title?.trim() || '新的数学问题';
}

export function conversationGroup(updatedAt: string): '今天' | '昨天' | '过去 7 天' | '过去 30 天' {
  const value = new Date(updatedAt).getTime();
  const age = Math.max(0, Date.now() - value);
  const day = 24 * 60 * 60 * 1000;
  if (age < day) return '今天';
  if (age < day * 2) return '昨天';
  if (age < day * 7) return '过去 7 天';
  return '过去 30 天';
}
