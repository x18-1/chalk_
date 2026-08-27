import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { VideoAdapter, VideoInput, VideoPollOutput, VideoSubmitOutput } from '../types';

export class SeedanceVideoAdapter implements VideoAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('Seedance requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  private root() { const base = this.options.baseUrl.replace(/\/$/, ''); return /\/api\//.test(base) ? base : `${base}/api/v3`; }
  async submit(input: VideoInput): Promise<VideoSubmitOutput> {
    const response = await this.fetcher(`${this.root()}/contents/generations/tasks`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model ?? 'doubao-seedance-2-0-260128', content: [{ type: 'text', text: input.prompt }], ...(input.aspectRatio ? { ratio: input.aspectRatio } : {}), ...(input.durationSeconds ? { duration: input.durationSeconds } : {}), ...(input.resolution ? { resolution: input.resolution } : {}), watermark: false }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Seedance');
    const data = await readJsonObject(response, 'Seedance');
    if (typeof data.id !== 'string' || !data.id) throw new ProviderError('MALFORMED_RESPONSE', 'Seedance returned no task id', true);
    return { providerTaskId: data.id };
  }
  async poll(providerTaskId: string, signal?: AbortSignal): Promise<VideoPollOutput> {
    const response = await this.fetcher(`${this.root()}/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`, { headers: { authorization: `Bearer ${this.options.apiKey}` }, signal: signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) throw mapHttpError(response.status, 'Seedance');
    const data = await readJsonObject(response, 'Seedance');
    if (data.status === 'succeeded' && typeof (data.content as { video_url?: unknown } | undefined)?.video_url === 'string') return { status: 'done', url: (data.content as { video_url: string }).video_url, contentType: 'video/mp4' };
    if (data.status === 'failed') return { status: 'failed', error: new ProviderError('UPSTREAM_FAILED', 'Seedance video generation failed', false) };
    return { status: 'pending' };
  }
  async testConnection(_model?: string) { const response = await this.fetcher(`${this.root()}/contents/generations/tasks/connectivity-test-nonexistent`, { headers: { authorization: `Bearer ${this.options.apiKey}` } }); if (response.status === 401 || response.status === 403) throw mapHttpError(response.status, 'Seedance'); }
}
