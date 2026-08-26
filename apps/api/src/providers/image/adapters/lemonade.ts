import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { ImageAdapter, ImageInput, ImageOutput } from '../types';

export class LemonadeImageAdapter implements ImageAdapter {
  private readonly fetcher: typeof globalThis.fetch;

  constructor(private readonly options: { apiKey?: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    if (!options.baseUrl.trim()) throw new Error('Lemonade Image requires a base URL');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async generate(input: ImageInput): Promise<ImageOutput> {
    const response = await this.fetcher(`${this.base()}/images/generations`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: input.model ?? 'Qwen-Image-GGUF',
        prompt: input.prompt,
        n: 1,
        size: `${input.width ?? 1024}x${input.height ?? 1024}`,
        response_format: 'b64_json',
      }),
      signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 300_000),
    });
    if (!response.ok) throw mapHttpError(response.status, 'Lemonade Image');
    const data = await readJsonObject(response, 'Lemonade Image');
    const item = (data.data as Array<{ url?: unknown; b64_json?: unknown }> | undefined)?.[0];
    if (typeof item?.b64_json === 'string' && item.b64_json) return { kind: 'bytes', bytes: Uint8Array.from(Buffer.from(item.b64_json, 'base64')), contentType: 'image/png' };
    if (typeof item?.url === 'string' && item.url) return { kind: 'remote', url: item.url, contentType: 'image/png' };
    throw new ProviderError('MALFORMED_RESPONSE', 'Lemonade Image returned no image', true);
  }

  async testConnection() {
    const response = await this.fetcher(`${this.base()}/models`, { headers: this.authHeaders(), signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Lemonade Image');
  }

  private base() { return this.options.baseUrl.replace(/\/$/, ''); }
  private authHeaders(): Record<string, string> { return this.options.apiKey?.trim() ? { authorization: `Bearer ${this.options.apiKey}` } : {}; }
}
