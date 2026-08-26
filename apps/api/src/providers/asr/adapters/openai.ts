import { mapHttpError, ProviderError } from '../../provider-error';
import type { AsrAdapter, AsrInput, AsrOutput } from '../types';

export class OpenAiAsrAdapter implements AsrAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; defaultModel?: string; requiresApiKey?: boolean; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    if (options.requiresApiKey !== false && !options.apiKey.trim()) throw new Error('OpenAI ASR requires an API key');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async transcribe(input: AsrInput): Promise<AsrOutput> {
    const body = new FormData();
    body.set('file', new File([input.bytes], input.filename, { type: input.contentType }));
    body.set('model', input.model ?? this.options.defaultModel ?? 'gpt-4o-mini-transcribe');
    if (input.language && input.language !== 'auto') body.set('language', input.language);
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}` }, body, signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) {
      if (response.status === 400 && /empty|too short/i.test(await response.text().catch(() => ''))) return { text: '' };
      throw mapHttpError(response.status, 'OpenAI ASR');
    }
    const data = await response.json() as { text?: unknown };
    if (typeof data.text !== 'string') throw new ProviderError('MALFORMED_RESPONSE', 'OpenAI ASR returned no transcript', true);
    return { text: data.text, ...(input.language && input.language !== 'auto' ? { language: input.language } : {}) };
  }

  async testConnection(model?: string) {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${this.options.apiKey}` } });
    if (!response.ok) throw mapHttpError(response.status, 'OpenAI ASR');
    void model;
  }
}
