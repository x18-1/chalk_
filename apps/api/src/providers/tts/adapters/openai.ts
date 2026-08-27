import { mapHttpError, ProviderError } from '../../provider-error';
import type { TtsAdapter, TtsFormat, TtsInput, TtsOutput } from '../types';

export class OpenAiTtsAdapter implements TtsAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; defaultModel?: string; defaultFormat?: TtsFormat; requiresApiKey?: boolean; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    if (options.requiresApiKey !== false && !options.apiKey.trim()) throw new Error('OpenAI TTS requires an API key');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async synthesize(input: TtsInput): Promise<TtsOutput> {
    const format = input.format ?? this.options.defaultFormat ?? 'mp3';
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/audio/speech`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: input.model ?? this.options.defaultModel ?? 'gpt-4o-mini-tts', input: input.text, voice: input.voice, speed: input.speed ?? 1, response_format: format }),
        signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (_error) {
      throw new ProviderError(input.signal?.aborted ? 'CANCELLED' : 'UPSTREAM_TIMEOUT', 'OpenAI TTS request failed', !input.signal?.aborted);
    }
    if (!response.ok) throw mapHttpError(response.status, 'OpenAI TTS');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new ProviderError('MALFORMED_RESPONSE', 'OpenAI TTS returned empty audio', true);
    return { bytes, format, contentType: response.headers.get('content-type')?.split(';')[0] ?? contentType(format) };
  }

  async testConnection(model?: string) {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${this.options.apiKey}` } });
    if (!response.ok) throw mapHttpError(response.status, 'OpenAI TTS');
    void model;
  }
}

function contentType(format: NonNullable<TtsInput['format']>) {
  return format === 'mp3' ? 'audio/mpeg' : `audio/${format}`;
}
