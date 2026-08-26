import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { TtsAdapter, TtsInput, TtsOutput } from '../types';

export class MiniMaxTtsAdapter implements TtsAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('MiniMax TTS requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async synthesize(input: TtsInput): Promise<TtsOutput> {
    const format = input.format === 'wav' ? 'wav' : 'mp3';
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1/t2a_v2`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model ?? 'speech-2.8-hd', text: input.text, stream: false, output_format: 'hex', voice_setting: { voice_id: input.voice, speed: input.speed ?? 1, vol: 1, pitch: 0 }, audio_setting: { sample_rate: 32000, bitrate: 128000, format, channel: 1 } }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 30_000) });
    if (!response.ok) throw mapHttpError(response.status, 'MiniMax TTS');
    const data = await readJsonObject(response, 'MiniMax TTS');
    const hex = (data.data as { audio?: unknown } | undefined)?.audio;
    if (typeof hex !== 'string' || !hex || hex.length % 2) throw new ProviderError('MALFORMED_RESPONSE', 'MiniMax TTS returned invalid audio', true);
    return { bytes: Uint8Array.from(hex.match(/.{1,2}/g)!.map((value) => Number.parseInt(value, 16))), format, contentType: format === 'mp3' ? 'audio/mpeg' : 'audio/wav' };
  }
  async testConnection(model?: string) { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1/t2a_v2`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? 'speech-2.8-hd', text: 'test', voice_setting: { voice_id: 'female-yujie' }, audio_setting: { format: 'mp3' } }) }); if (!response.ok) throw mapHttpError(response.status, 'MiniMax TTS'); }
}
