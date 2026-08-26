import { mapHttpError, ProviderError } from '../../provider-error';
import type { TtsAdapter, TtsInput, TtsOutput } from '../types';

export class ElevenLabsTtsAdapter implements TtsAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('ElevenLabs TTS requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async synthesize(input: TtsInput): Promise<TtsOutput> {
    const format = input.format ?? 'mp3';
    const outputFormat = format === 'wav' ? 'wav_44100' : format === 'opus' ? 'opus_48000_96' : 'mp3_44100_128';
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/text-to-speech/${encodeURIComponent(input.voice)}?output_format=${outputFormat}`, { method: 'POST', headers: { 'xi-api-key': this.options.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ text: input.text, model_id: input.model ?? 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, input.speed ?? 1)) } }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 30_000) });
    if (!response.ok) throw mapHttpError(response.status, 'ElevenLabs TTS');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new ProviderError('MALFORMED_RESPONSE', 'ElevenLabs returned empty audio', true);
    return { bytes, format, contentType: response.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg' };
  }
  async testConnection() { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/user`, { headers: { 'xi-api-key': this.options.apiKey } }); if (!response.ok) throw mapHttpError(response.status, 'ElevenLabs TTS'); }
}
