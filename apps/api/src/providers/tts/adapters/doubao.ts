import { mapHttpError, ProviderError } from '../../provider-error';
import type { TtsAdapter, TtsInput, TtsOutput } from '../types';

export class DoubaoTtsAdapter implements TtsAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Doubao TTS requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async synthesize(input: TtsInput): Promise<TtsOutput> {
    const response = await this.fetcher(this.endpoint(), { method: 'POST', headers: this.headers(), body: JSON.stringify(this.body(input)), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 30_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Doubao TTS');
    const text = await response.text();
    const chunks: Uint8Array[] = [];
    for (const part of splitObjects(text)) {
      try { const item = JSON.parse(part) as { code?: number; data?: string; message?: string }; if (item.code === 0 && item.data) chunks.push(Uint8Array.from(Buffer.from(item.data, 'base64'))); if (item.code && item.code !== 0 && item.code !== 20000000) throw new ProviderError('UPSTREAM_FAILED', item.message ?? 'Doubao TTS failed', item.code >= 50000000); } catch (error) { if (error instanceof ProviderError) throw error; }
    }
    const bytes = Uint8Array.from(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
    if (!bytes.byteLength) throw new ProviderError('MALFORMED_RESPONSE', 'Doubao TTS returned no audio', true);
    return { bytes, format: 'mp3', contentType: 'audio/mpeg' };
  }
  async testConnection() {
    const response = await this.fetcher(this.endpoint(), { method: 'POST', headers: this.headers(), body: JSON.stringify(this.body({ text: 'test', voice: 'zh_female_vv_uranus_bigtts' })) });
    if (!response.ok) throw mapHttpError(response.status, 'Doubao TTS');
  }

  private endpoint() { return `${this.options.baseUrl.replace(/\/$/, '')}/unidirectional`; }
  private headers(): Record<string, string> {
    const pair = this.options.apiKey.split(':');
    const headers: Record<string, string> = { 'x-api-resource-id': 'seed-tts-2.0', 'content-type': 'application/json' };
    if (pair.length === 2) {
      headers['x-api-app-id'] = pair[0]!;
      headers['x-api-access-key'] = pair[1]!;
    } else {
      headers['x-api-key'] = this.options.apiKey;
    }
    return headers;
  }
  private body(input: Pick<TtsInput, 'text' | 'voice' | 'speed'>) {
    return { user: { uid: 'chalk' }, req_params: { text: input.text, speaker: input.voice, audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Math.round(((input.speed ?? 1) - 1) * 100) } } };
  }
}

function splitObjects(input: string) { const result: string[] = []; let depth = 0; let start = -1; let quoted = false; let escaped = false; for (let i = 0; i < input.length; i += 1) { const char = input[i]!; if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; } if (char === '"') { quoted = true; continue; } if (char === '{') { if (depth === 0) start = i; depth += 1; } else if (char === '}') { depth -= 1; if (depth === 0 && start >= 0) { result.push(input.slice(start, i + 1)); start = -1; } } } return result; }
