import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { ImageAdapter, ImageInput, ImageOutput } from '../types';

export class MiniMaxImageAdapter implements ImageAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('MiniMax Image requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async generate(input: ImageInput): Promise<ImageOutput> {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1/image_generation`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model ?? 'image-01', prompt: input.prompt, negative_prompt: input.negativePrompt, aspect_ratio: input.aspectRatio ?? '1:1', response_format: 'url', n: 1 }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 300_000) });
    if (!response.ok) throw mapHttpError(response.status, 'MiniMax Image');
    const data = await readJsonObject(response, 'MiniMax Image');
    const url = (data.data as { image_urls?: unknown } | undefined)?.image_urls;
    if (!Array.isArray(url) || typeof url[0] !== 'string') throw new ProviderError('MALFORMED_RESPONSE', 'MiniMax Image returned no image URL', true);
    return { kind: 'remote', url: url[0], contentType: 'image/png' };
  }
  async testConnection(model?: string) { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1/image_generation`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? 'image-01', prompt: 'test', aspect_ratio: '1:1', n: 1 }) }); if (!response.ok) throw mapHttpError(response.status, 'MiniMax Image'); }
}
