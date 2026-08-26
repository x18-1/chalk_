import { joinUrl, mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { TtsAdapter, TtsInput, TtsOutput } from '../types';

export class QwenTtsAdapter implements TtsAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    if (!options.apiKey.trim()) throw new Error('Qwen TTS requires an API key');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async synthesize(input: TtsInput): Promise<TtsOutput> {
    const response = await this.fetcher(joinUrl(this.options.baseUrl, '/services/aigc/multimodal-generation/generation'), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ model: input.model ?? 'qwen3-tts-flash', input: { text: input.text, voice: input.voice, language_type: 'Chinese' }, parameters: { rate: Math.round(((input.speed ?? 1) - 1) * 500) } }),
      signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    if (!response.ok) throw mapHttpError(response.status, 'Qwen TTS');
    const data = await readJsonObject(response, 'Qwen TTS');
    const audioUrl = ((data.output as { audio?: { url?: unknown } } | undefined)?.audio?.url);
    if (typeof audioUrl !== 'string' || !audioUrl) throw new ProviderError('MALFORMED_RESPONSE', 'Qwen TTS returned no audio URL', true);
    const audio = await this.fetcher(audioUrl, { signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 30_000) });
    if (!audio.ok) throw mapHttpError(audio.status, 'Qwen TTS audio');
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (!bytes.byteLength) throw new ProviderError('MALFORMED_RESPONSE', 'Qwen TTS returned empty audio', true);
    return { bytes, format: 'wav', contentType: audio.headers.get('content-type')?.split(';')[0] ?? 'audio/wav' };
  }

  async testConnection(model?: string) {
    const response = await this.fetcher(joinUrl(this.options.baseUrl, '/services/aigc/multimodal-generation/generation'), { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? 'qwen3-tts-flash', input: { text: 'test', voice: 'Cherry' } }) });
    if (!response.ok) throw mapHttpError(response.status, 'Qwen TTS');
  }
}
