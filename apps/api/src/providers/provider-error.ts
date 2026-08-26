export type ProviderErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_FAILED'
  | 'MALFORMED_RESPONSE'
  | 'CANCELLED'
  | 'UNSUPPORTED';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly emptyResult = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function mapHttpError(status: number, provider: string) {
  if (status === 401 || status === 403) {
    return new ProviderError('AUTH_FAILED', `${provider} authentication failed`, false);
  }
  if (status === 429) {
    return new ProviderError('RATE_LIMITED', `${provider} rate limit exceeded`, true);
  }
  return new ProviderError(
    status >= 500 ? 'UPSTREAM_FAILED' : 'INVALID_REQUEST',
    `${provider} request failed (${status})`,
    status >= 500,
  );
}

export async function readJsonObject(response: Response, provider: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Normalize below.
  }
  throw new ProviderError('MALFORMED_RESPONSE', `${provider} returned malformed JSON`, true);
}

export function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}
