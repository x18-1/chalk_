import { joinUrl, mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { ImageAdapter, ImageInput, ImageOutput } from '../types';

export class QwenImageAdapter implements ImageAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Qwen Image requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async generate(input: ImageInput): Promise<ImageOutput> {
    const response = await this.fetcher(joinUrl(this.options.baseUrl, '/api/v1/services/aigc/multimodal-generation/generation'), { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model ?? 'qwen-image-max', input: { messages: [{ role: 'user', content: [{ text: input.prompt }] }] }, parameters: { size: `${input.width ?? 1024}*${input.height ?? 576}`, prompt_extend: true, watermark: false, ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}) } }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 300_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Qwen Image');
    const data = await readJsonObject(response, 'Qwen Image');
    const content = (data.output as { choices?: Array<{ message?: { content?: Array<{ image?: unknown }> } }> } | undefined)?.choices?.[0]?.message?.content;
    const url = content?.find((item) => typeof item.image === 'string')?.image;
    if (typeof url !== 'string' || !url) throw new ProviderError('MALFORMED_RESPONSE', 'Qwen Image returned no image URL', true);
    return { kind: 'remote', url, contentType: 'image/png' };
  }
  async testConnection(model?: string) { const response = await this.fetcher(joinUrl(this.options.baseUrl, '/api/v1/services/aigc/multimodal-generation/generation'), { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? 'qwen-image-max', input: { messages: [{ role: 'user', content: [{ text: 'test' }] }] }, parameters: { size: '1024*1024' } }) }); if (!response.ok) throw mapHttpError(response.status, 'Qwen Image'); }
}
