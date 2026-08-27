import { mapHttpError, ProviderError } from '../../provider-error';
import type { TtsAdapter, TtsInput, TtsOutput, VoxCpmBackend, VoxCpmOptions } from '../types';

export class VoxCpmTtsAdapter implements TtsAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey?: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    if (!options.baseUrl.trim()) throw new Error('VoxCPM requires a base URL');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  async synthesize(input: TtsInput): Promise<TtsOutput> {
    const provider = input.providerOptions ?? {};
    const backend = normalizeBackend(provider.backend);
    const response = await this.fetcher(this.endpoint(backend), this.request(backend, input, provider));
    if (!response.ok) throw mapHttpError(response.status, 'VoxCPM TTS');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new ProviderError('MALFORMED_RESPONSE', 'VoxCPM returned empty audio', true);
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? 'audio/wav';
    return { bytes, contentType, format: audioFormat(contentType) };
  }
  async testConnection() {
    const response = await this.fetcher(`${this.base()}/health`, { headers: this.headers(), signal: this.signal() });
    if (!response.ok) throw mapHttpError(response.status, 'VoxCPM');
  }
  private endpoint(backend: VoxCpmBackend) { const base = this.base(); return backend === 'vllm-omni' ? `${base}${base.endsWith('/v1') ? '/audio/speech' : '/v1/audio/speech'}` : `${base}/${backend === 'python-api' ? 'tts/upload' : 'generate'}`; }
  private request(backend: VoxCpmBackend, input: TtsInput, options: VoxCpmOptions): RequestInit {
    const target = targetText(input.text, options.voicePrompt);
    if (backend === 'python-api') {
      const form = new FormData(); form.set('text', target); form.set('cfg_value', String(options.cfgValue ?? 2)); form.set('inference_timesteps', String(options.inferenceTimesteps ?? 10)); form.set('normalize', String(options.normalize ?? false)); form.set('denoise', String(options.denoise ?? false));
      if (options.referenceAudioBase64) form.set('reference_audio', new File([Uint8Array.from(Buffer.from(options.referenceAudioBase64, 'base64'))], options.referenceAudioName ?? 'reference.wav', { type: options.referenceAudioMimeType ?? 'audio/wav' }));
      if (options.promptText) form.set('prompt_text', options.promptText);
      return { method: 'POST', headers: this.headers(), body: form, signal: input.signal ?? this.signal() };
    }
    const payload: Record<string, unknown> = backend === 'vllm-omni'
      ? { model: input.model ?? 'voxcpm2', input: target, voice: options.registeredVoiceId ?? 'default', response_format: 'wav', stream: false }
      : { target_text: target, cfg_value: options.cfgValue ?? 2 };
    if (options.referenceAudioBase64) {
      if (backend === 'vllm-omni') { payload.ref_audio = `data:${options.referenceAudioMimeType ?? 'audio/wav'};base64,${options.referenceAudioBase64}`; if (options.promptText) { payload.prompt_audio = payload.ref_audio; payload.prompt_text = options.promptText; } }
      else { payload.ref_audio_wav_base64 = options.referenceAudioBase64; payload.ref_audio_wav_format = audioFormat(options.referenceAudioMimeType ?? 'audio/wav'); if (options.promptText) { payload.prompt_wav_base64 = options.referenceAudioBase64; payload.prompt_wav_format = payload.ref_audio_wav_format; payload.prompt_text = options.promptText; } }
    }
    return { method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: input.signal ?? this.signal() };
  }
  private base() { return this.options.baseUrl.replace(/\/$/, ''); }
  private headers(): Record<string, string> { return this.options.apiKey?.trim() ? { authorization: `Bearer ${this.options.apiKey}` } : {}; }
  private signal() { return AbortSignal.timeout(this.options.timeoutMs ?? 60_000); }
}
function normalizeBackend(value?: VoxCpmBackend): VoxCpmBackend { return value === 'python-api' || value === 'nano-vllm' ? value : 'vllm-omni'; }
function targetText(text: string, prompt?: string) { const clean = prompt ? withoutControlCharacters(prompt).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim() : ''; return clean ? `(${clean})${text}` : text; }
function withoutControlCharacters(value: string) { return [...value].map((character) => character.charCodeAt(0) <= 0x1f ? ' ' : character).join(''); }
function audioFormat(contentType: string): 'mp3' | 'opus' | 'wav' | 'aac' | 'flac' | 'pcm' { if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3'; if (contentType.includes('flac')) return 'flac'; if (contentType.includes('ogg') || contentType.includes('opus')) return 'opus'; if (contentType.includes('aac')) return 'aac'; return 'wav'; }
