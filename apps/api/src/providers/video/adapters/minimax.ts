import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { VideoAdapter, VideoInput, VideoPollOutput, VideoSubmitOutput } from '../types';

export class MiniMaxVideoAdapter implements VideoAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) { if (!options.apiKey.trim()) throw new Error('MiniMax Video requires an API key'); this.fetcher = options.fetch ?? globalThis.fetch; }
  async submit(input: VideoInput): Promise<VideoSubmitOutput> {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1/video_generation`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model ?? 'MiniMax-Hailuo-2.3', prompt: input.prompt, duration: input.durationSeconds ?? 6, resolution: input.resolution === '1080p' ? '1080P' : '768P', prompt_optimizer: false }), signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) throw mapHttpError(response.status, 'MiniMax Video');
    const data = await readJsonObject(response, 'MiniMax Video');
    const taskId = data.task_id;
    if (typeof taskId !== 'string' || !taskId) throw new ProviderError('MALFORMED_RESPONSE', 'MiniMax Video returned no task id', true);
    return { providerTaskId: taskId };
  }
  async poll(providerTaskId: string, signal?: AbortSignal): Promise<VideoPollOutput> {
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1/query/video_generation?task_id=${encodeURIComponent(providerTaskId)}`, { headers: { authorization: `Bearer ${this.options.apiKey}` }, signal: signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!response.ok) throw mapHttpError(response.status, 'MiniMax Video');
    const data = await readJsonObject(response, 'MiniMax Video');
    if (data.status === 'Fail') return { status: 'failed', error: new ProviderError('UPSTREAM_FAILED', 'MiniMax Video generation failed', false) };
    if (data.status !== 'Success') return { status: 'pending' };
    if (typeof data.file_id !== 'string') throw new ProviderError('MALFORMED_RESPONSE', 'MiniMax Video returned no file id', true);
    const file = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1/files/retrieve?file_id=${encodeURIComponent(data.file_id)}`, { headers: { authorization: `Bearer ${this.options.apiKey}` }, signal: signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    if (!file.ok) throw mapHttpError(file.status, 'MiniMax Video file');
    const fileData = await readJsonObject(file, 'MiniMax Video file');
    const url = (fileData.file as { download_url?: unknown } | undefined)?.download_url;
    if (typeof url !== 'string' || !url) throw new ProviderError('MALFORMED_RESPONSE', 'MiniMax Video returned no download URL', true);
    return { status: 'done', url, contentType: 'video/mp4' };
  }
  async testConnection(model?: string) { const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/v1/video_generation`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? 'MiniMax-Hailuo-2.3', prompt: 'test', duration: 6, resolution: '768P' }) }); if (!response.ok) throw mapHttpError(response.status, 'MiniMax Video'); }
}
