import { joinUrl, mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { ImageAdapter, ImageInput, ImageOutput } from '../types';

export class SeedreamImageAdapter implements ImageAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Seedream requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async generate(input: ImageInput): Promise<ImageOutput> {
    const response = await this.fetcher(joinUrl(this.options.baseUrl, '/api/v3/images/generations'), { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model ?? 'doubao-seedream-4-5-251128', prompt: input.prompt, size: size(input), watermark: false }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 300_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Seedream');
    const data = await readJsonObject(response, 'Seedream');
    const item = (data.data as Array<{ url?: unknown; b64_json?: unknown }> | undefined)?.[0];
    if (typeof item?.b64_json === 'string') return { kind: 'bytes', bytes: Uint8Array.from(Buffer.from(item.b64_json, 'base64')), contentType: 'image/png' };
    if (typeof item?.url === 'string') return { kind: 'remote', url: item.url, contentType: 'image/png' };
    throw new ProviderError('MALFORMED_RESPONSE', 'Seedream returned no image', true);
  }
  async testConnection(model?: string) { const response = await this.fetcher(joinUrl(this.options.baseUrl, '/api/v3/images/generations'), { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? 'doubao-seedream-4-5-251128', prompt: 'test', size: '1024x1024' }) }); if (!response.ok) throw mapHttpError(response.status, 'Seedream'); }
}
function size(input: ImageInput) { if (input.aspectRatio === '16:9') return '1664x936'; if (input.aspectRatio === '9:16') return '936x1664'; return `${input.width ?? 1024}x${input.height ?? 1024}`; }
