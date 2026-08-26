import { joinUrl, mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { VideoAdapter, VideoInput, VideoPollOutput, VideoSubmitOutput } from '../types';

export class HappyHorseVideoAdapter implements VideoAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('HappyHorse requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async submit(input: VideoInput): Promise<VideoSubmitOutput> {
    const response = await this.fetcher(joinUrl(this.options.baseUrl, '/api/v1/services/aigc/video-generation/video-synthesis'), { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json', 'x-dashscope-async': 'enable' }, body: JSON.stringify({ model: input.model ?? 'happyhorse-1.0-t2v', input: { prompt: input.prompt }, parameters: { resolution: input.resolution === '1080p' ? '1080P' : '720P', ratio: input.aspectRatio ?? '16:9', duration: input.durationSeconds ?? 5, watermark: false } }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) throw mapHttpError(response.status, 'HappyHorse');
    const data = await readJsonObject(response, 'HappyHorse');
    const taskId = (data.output as { task_id?: unknown } | undefined)?.task_id;
    if (typeof taskId !== 'string' || !taskId) throw new ProviderError('MALFORMED_RESPONSE', 'HappyHorse returned no task id', true);
    return { providerTaskId: taskId };
  }
  async poll(providerTaskId: string, signal?: AbortSignal): Promise<VideoPollOutput> {
    const response = await this.fetcher(joinUrl(this.options.baseUrl, `/api/v1/tasks/${encodeURIComponent(providerTaskId)}`), { headers: { authorization: `Bearer ${this.options.apiKey}` }, signal: signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) throw mapHttpError(response.status, 'HappyHorse');
    const data = await readJsonObject(response, 'HappyHorse');
    const output = data.output as { task_status?: string; video_url?: unknown; message?: string } | undefined;
    if (output?.task_status === 'SUCCEEDED' && typeof output.video_url === 'string') return { status: 'done', url: output.video_url, contentType: 'video/mp4' };
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(output?.task_status ?? '')) return { status: 'failed', error: new ProviderError('UPSTREAM_FAILED', output?.message ?? 'HappyHorse video generation failed', false) };
    return { status: 'pending' };
  }
  async testConnection(_model?: string) { const response = await this.fetcher(joinUrl(this.options.baseUrl, '/api/v1/tasks/connectivity-test-nonexistent'), { headers: { authorization: `Bearer ${this.options.apiKey}` } }); if (response.status === 401 || response.status === 403) throw mapHttpError(response.status, 'HappyHorse'); }
}
