import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { ImageAdapter, ImageInput, ImageOutput } from '../types';

export class GrokImageAdapter implements ImageAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Grok Image requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async generate(input: ImageInput): Promise<ImageOutput> {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/images/generations`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model ?? 'grok-imagine-image', prompt: input.prompt, n: 1 }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 300_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Grok Image');
    const data = await readJsonObject(response, 'Grok Image');
    const item = (data.data as Array<{ url?: unknown; b64_json?: unknown }> | undefined)?.[0];
    if (typeof item?.b64_json === 'string') return { kind: 'bytes', bytes: Uint8Array.from(Buffer.from(item.b64_json, 'base64')), contentType: 'image/png' };
    if (typeof item?.url === 'string') return { kind: 'remote', url: item.url, contentType: 'image/png' };
    throw new ProviderError('MALFORMED_RESPONSE', 'Grok Image returned no image', true);
  }
  async testConnection(model?: string) { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/images/generations`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? 'grok-imagine-image', prompt: 'test', n: 1 }) }); if (!response.ok) throw mapHttpError(response.status, 'Grok Image'); }
}
