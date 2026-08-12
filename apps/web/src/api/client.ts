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
  return input.startsWith('http://') || input.startsWith('https://')
    ? input
    : `${API_BASE_URL}${input.startsWith('/') ? input : `/${input}`}`;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
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
