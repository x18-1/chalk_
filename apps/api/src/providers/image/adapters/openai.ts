import { mapHttpError, ProviderError } from '../../provider-error';
import type { ImageAdapter, ImageInput, ImageOutput } from '../types';

export class OpenAiImageAdapter implements ImageAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('OpenAI Image requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async generate(input: ImageInput): Promise<ImageOutput> {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/images/generations`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model ?? 'gpt-image-1.5', prompt: input.prompt, n: 1, size: size(input) }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 300_000) });
    if (!response.ok) throw mapHttpError(response.status, 'OpenAI Image');
    const data = await response.json() as { data?: Array<{ url?: unknown; b64_json?: unknown }> };
    const item = data.data?.[0];
    if (typeof item?.b64_json === 'string' && item.b64_json) return { kind: 'bytes', bytes: Uint8Array.from(Buffer.from(item.b64_json, 'base64')), contentType: 'image/png' };
    if (typeof item?.url === 'string' && item.url) return { kind: 'remote', url: item.url, contentType: 'image/png' };
    throw new ProviderError('MALFORMED_RESPONSE', 'OpenAI Image returned no image', true);
  }
  async testConnection() { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${this.options.apiKey}` } }); if (!response.ok) throw mapHttpError(response.status, 'OpenAI Image'); }
}
function size(input: ImageInput) { if (input.aspectRatio === '16:9') return '1536x1024'; if (input.aspectRatio === '9:16') return '1024x1536'; return `${input.width ?? 1024}x${input.height ?? 1024}`; }
