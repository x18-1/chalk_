export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Keep local development requests same-site when the app is opened through a
 * different loopback alias (for example 127.0.0.1 instead of localhost).
 * SameSite=Lax session cookies are host-scoped, so mixing these aliases makes
 * a successful login look unauthenticated on the next request.
 */
export function resolvedApiBaseUrl() {
  if (typeof window === 'undefined') return API_BASE_URL;

  try {
    const configured = new URL(API_BASE_URL);
    const pageHostname = window.location.hostname;
    if (
      isLoopbackHostname(configured.hostname) &&
      isLoopbackHostname(pageHostname) &&
      configured.hostname !== pageHostname
    ) {
      configured.hostname = pageHostname;
      return configured.toString().replace(/\/$/, '');
    }
  } catch {
    // Keep the configured value; apiUrl will surface a normal fetch error.
  }

  return API_BASE_URL;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function apiUrl(input: RequestInfo | URL) {
  if (input instanceof URL) return input.toString();
  if (typeof input !== 'string') return input;
  return input.startsWith('http://') || input.startsWith('https://')
    ? input
    : `${resolvedApiBaseUrl()}${input.startsWith('/') ? input : `/${input}`}`;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      body.error ?? `Request failed (${response.status})`,
      body.code,
    );
  }
  return body;
}
