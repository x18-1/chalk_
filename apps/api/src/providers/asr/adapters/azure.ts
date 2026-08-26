import { mapHttpError, ProviderError } from '../../provider-error';
import type { AsrAdapter, AsrInput, AsrOutput } from '../types';

export class AzureAsrAdapter implements AsrAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Azure ASR requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async transcribe(input: AsrInput): Promise<AsrOutput> {
    const endpoint = new URL(this.options.baseUrl.includes('transcriptions:transcribe') ? this.options.baseUrl : `${this.options.baseUrl.replace(/\/$/, '')}/speechtotext/transcriptions:transcribe`);
    if (!endpoint.searchParams.has('api-version')) endpoint.searchParams.set('api-version', '2025-10-15');
    const body = new FormData();
    body.set('audio', new File([input.bytes], input.filename, { type: input.contentType }));
    if (input.language && input.language !== 'auto') body.set('definition', JSON.stringify({ locales: [locale(input.language)] }));
    const response = await this.fetcher(endpoint, { method: 'POST', headers: { 'ocp-apim-subscription-key': this.options.apiKey }, body, signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Azure ASR');
    const data = await response.json() as { combinedPhrases?: Array<{ text?: unknown }>; phrases?: Array<{ text?: unknown }> };
    const text = data.combinedPhrases?.[0]?.text ?? data.phrases?.[0]?.text ?? '';
    if (typeof text !== 'string') throw new ProviderError('MALFORMED_RESPONSE', 'Azure ASR returned no transcript', true);
    return { text, ...(input.language && input.language !== 'auto' ? { language: input.language } : {}) };
  }
  async testConnection() { const response = await this.fetcher(this.options.baseUrl, { headers: { 'ocp-apim-subscription-key': this.options.apiKey } }); if (!response.ok && response.status !== 400 && response.status !== 405) throw mapHttpError(response.status, 'Azure ASR'); }
}
function locale(language: string) { return ({ en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE' } as Record<string, string>)[language] ?? language; }
