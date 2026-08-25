import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { ImageAdapter, ImageInput, ImageOutput } from '../types';

export class NanoBananaImageAdapter implements ImageAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Nano Banana requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async generate(input: ImageInput): Promise<ImageOutput> {
    const model = input.model ?? 'gemini-2.5-flash-image';
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.options.apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: input.prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 300_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Nano Banana');
    const data = await readJsonObject(response, 'Nano Banana');
    const parts = (data.candidates as Array<{ content?: { parts?: Array<{ inlineData?: { data?: unknown; mimeType?: unknown } }> } }> | undefined)?.[0]?.content?.parts;
    const image = parts?.find((part) => typeof part.inlineData?.data === 'string')?.inlineData;
    if (typeof image?.data !== 'string') throw new ProviderError('MALFORMED_RESPONSE', 'Nano Banana returned no image', true);
    return { kind: 'bytes', bytes: Uint8Array.from(Buffer.from(image.data, 'base64')), contentType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png' };
  }
  async testConnection() { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1beta/models`, { headers: { 'x-goog-api-key': this.options.apiKey } }); if (!response.ok) throw mapHttpError(response.status, 'Nano Banana'); }
}
