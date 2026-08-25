import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { VideoAdapter, VideoInput, VideoPollOutput, VideoSubmitOutput } from '../types';

export class VeoVideoAdapter implements VideoAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Veo requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async submit(input: VideoInput): Promise<VideoSubmitOutput> { const model = input.model ?? 'veo-3.1-fast-generate-001'; const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:predictLongRunning`, { method: 'POST', headers: { 'x-goog-api-key': this.options.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ instances: [{ prompt: input.prompt }], ...(input.aspectRatio || input.durationSeconds ? { parameters: { ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}), ...(input.durationSeconds ? { durationSeconds: input.durationSeconds } : {}) } } : {}) }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) }); if (!response.ok) throw mapHttpError(response.status, 'Veo'); const data = await readJsonObject(response, 'Veo'); if (typeof data.name !== 'string' || !data.name) throw new ProviderError('MALFORMED_RESPONSE', 'Veo returned no operation name', true); return { providerTaskId: data.name }; }
  async poll(providerTaskId: string, signal?: AbortSignal, model = 'veo-3.1-fast-generate-001'): Promise<VideoPollOutput> {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:fetchPredictOperation`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.options.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ operationName: providerTaskId }),
      signal: signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
    });
    if (!response.ok) throw mapHttpError(response.status, 'Veo');
    const data = await readJsonObject(response, 'Veo');
    if (!data.done) return { status: 'pending' };
    if (data.error) return { status: 'failed', error: new ProviderError('UPSTREAM_FAILED', 'Veo video generation failed', false) };

    const video = (data.response as { videos?: Array<{ bytesBase64Encoded?: unknown; mimeType?: unknown }> } | undefined)?.videos?.[0];
    if (typeof video?.bytesBase64Encoded !== 'string' || !video.bytesBase64Encoded) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Veo returned no inline video bytes', true);
    }
    const contentType = typeof video.mimeType === 'string' && video.mimeType ? video.mimeType : 'video/mp4';
    return { status: 'done', url: `data:${contentType};base64,${video.bytesBase64Encoded}`, contentType };
  }
  async testConnection(_model?: string) { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1beta/models`, { headers: { 'x-goog-api-key': this.options.apiKey } }); if (!response.ok) throw mapHttpError(response.status, 'Veo'); }
}
