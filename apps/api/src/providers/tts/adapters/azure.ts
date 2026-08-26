import { mapHttpError, ProviderError } from '../../provider-error';
import type { TtsAdapter, TtsInput, TtsOutput } from '../types';

export class AzureTtsAdapter implements TtsAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Azure TTS requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async synthesize(input: TtsInput): Promise<TtsOutput> {
    const rate = `${Math.round(((input.speed ?? 1) - 1) * 100)}%`;
    const escape = input.text.replace(/[&<>"']/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[value]!);
    const ssml = `<speak version="1.0" xml:lang="zh-CN"><voice xml:lang="zh-CN" name="${input.voice}"><prosody rate="${rate}">${escape}</prosody></voice></speak>`;
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/cognitiveservices/v1`, { method: 'POST', headers: { 'ocp-apim-subscription-key': this.options.apiKey, 'content-type': 'application/ssml+xml; charset=utf-8', 'x-microsoft-outputformat': 'audio-16khz-128kbitrate-mono-mp3' }, body: ssml, signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 30_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Azure TTS');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new ProviderError('MALFORMED_RESPONSE', 'Azure TTS returned empty audio', true);
    return { bytes, format: 'mp3', contentType: 'audio/mpeg' };
  }
  async testConnection() { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/cognitiveservices/v1`, { method: 'POST', headers: { 'ocp-apim-subscription-key': this.options.apiKey, 'content-type': 'application/ssml+xml' }, body: '<speak version="1.0" xml:lang="en-US"><voice name="en-US-JennyNeural">test</voice></speak>' }); if (!response.ok) throw mapHttpError(response.status, 'Azure TTS'); }
}
