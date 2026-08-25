import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { VideoAdapter, VideoInput, VideoPollOutput, VideoSubmitOutput } from '../types';

export class GrokVideoAdapter implements VideoAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Grok Video requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async submit(input: VideoInput): Promise<VideoSubmitOutput> {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/videos/generations`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model ?? 'grok-imagine-video', prompt: input.prompt, ...(input.durationSeconds ? { duration: input.durationSeconds } : {}) }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Grok Video');
    const data = await readJsonObject(response, 'Grok Video');
    const taskId = data.request_id;
    if (typeof taskId !== 'string' || !taskId) throw new ProviderError('MALFORMED_RESPONSE', 'Grok Video returned no request id', true);
    return { providerTaskId: taskId };
  }
  async poll(providerTaskId: string, signal?: AbortSignal): Promise<VideoPollOutput> {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/videos/${encodeURIComponent(providerTaskId)}`, { headers: { authorization: `Bearer ${this.options.apiKey}` }, signal: signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Grok Video');
    const data = await readJsonObject(response, 'Grok Video');
    if (data.status === 'done' && typeof (data.video as { url?: unknown } | undefined)?.url === 'string') return { status: 'done', url: (data.video as { url: string }).url, contentType: 'video/mp4', durationSeconds: Number((data.video as { duration?: unknown }).duration) || undefined };
    if (data.status === 'failed') return { status: 'failed', error: new ProviderError('UPSTREAM_FAILED', 'Grok Video generation failed', false) };
    return { status: 'pending' };
  }
  async testConnection(model?: string) { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/videos/generations`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? 'grok-imagine-video', prompt: '' }) }); if (!response.ok && response.status !== 400) throw mapHttpError(response.status, 'Grok Video'); }
}
