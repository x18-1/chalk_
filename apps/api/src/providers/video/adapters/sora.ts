import { mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { VideoAdapter, VideoInput, VideoPollOutput, VideoSubmitOutput } from '../types';

export class SoraVideoAdapter implements VideoAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    if (!options.apiKey.trim()) throw new Error('Sora requires an API key');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  async submit(input: VideoInput): Promise<VideoSubmitOutput> {
    const form = new FormData();
    form.set('model', input.model ?? 'sora-2');
    form.set('prompt', input.prompt);
    if (input.durationSeconds) form.set('seconds', String(input.durationSeconds));
    if (input.resolution) form.set('size', input.resolution === '1080p' ? (input.aspectRatio === '9:16' ? '1080x1920' : '1920x1080') : (input.aspectRatio === '9:16' ? '720x1280' : '1280x720'));
    const response = await this.fetcher(`${this.base()}/videos`, { method: 'POST', headers: this.headers(), body: form, signal: input.signal ?? this.signal() });
    if (!response.ok) throw mapHttpError(response.status, 'Sora');
    const data = await readJsonObject(response, 'Sora');
    if (typeof data.id !== 'string' || !data.id) throw new ProviderError('MALFORMED_RESPONSE', 'Sora returned no video id', true);
    return { providerTaskId: data.id };
  }
  async poll(providerTaskId: string, signal?: AbortSignal): Promise<VideoPollOutput> {
    const response = await this.fetcher(`${this.base()}/videos/${encodeURIComponent(providerTaskId)}`, { headers: this.headers(), signal: signal ?? this.signal() });
    if (!response.ok) throw mapHttpError(response.status, 'Sora');
    const data = await readJsonObject(response, 'Sora');
    if (data.status === 'queued' || data.status === 'in_progress') return { status: 'pending' };
    if (data.status === 'failed') return { status: 'failed', error: new ProviderError('UPSTREAM_FAILED', errorMessage(data), false) };
    if (data.status !== 'completed') throw new ProviderError('MALFORMED_RESPONSE', 'Sora returned unknown video status', true);
    const content = await this.fetcher(`${this.base()}/videos/${encodeURIComponent(providerTaskId)}/content`, { headers: this.headers(), signal: signal ?? this.signal() });
    if (!content.ok) throw mapHttpError(content.status, 'Sora video content');
    const bytes = new Uint8Array(await content.arrayBuffer());
    if (!bytes.byteLength) throw new ProviderError('MALFORMED_RESPONSE', 'Sora returned empty video content', true);
    return { status: 'done', bytes, contentType: content.headers.get('content-type')?.split(';')[0] ?? 'video/mp4', durationSeconds: typeof data.seconds === 'number' ? data.seconds : undefined };
  }
  async testConnection(_model?: string) {
    const response = await this.fetcher(`${this.base()}/models`, { headers: this.headers(), signal: this.signal() });
    if (!response.ok) throw mapHttpError(response.status, 'Sora');
  }
  private base() { return this.options.baseUrl.replace(/\/$/, ''); }
  private headers(): Record<string, string> { return { authorization: `Bearer ${this.options.apiKey}` }; }
  private signal() { return AbortSignal.timeout(this.options.timeoutMs ?? 60_000); }
}
function errorMessage(data: Record<string, unknown>) { const error = data.error as Record<string, unknown> | undefined; return typeof error?.message === 'string' ? error.message : 'Sora video generation failed'; }
