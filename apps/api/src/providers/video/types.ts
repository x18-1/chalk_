import type { ProviderError } from '../provider-error';
import type { ProviderModel } from '../model';

export type VideoProviderId = 'happyhorse' | 'grok' | 'minimax' | 'seedance' | 'kling' | 'veo' | 'sora';
export type VideoProviderConfig = { id: VideoProviderId; name: string; defaultBaseUrl: string; models: readonly ProviderModel[]; defaultModel: string; async: true; aspectRatios: readonly string[]; durations: readonly number[]; resolutions: readonly string[]; requiresApiKey: boolean };
export type VideoInput = { prompt: string; model?: string; aspectRatio?: string; durationSeconds?: number; resolution?: string; signal?: AbortSignal };
export type VideoSubmitOutput = { providerTaskId: string };
export type VideoPollOutput = { status: 'pending' } | { status: 'failed'; error: ProviderError } | { status: 'done'; url?: string; bytes?: Uint8Array; contentType: string; durationSeconds?: number; width?: number; height?: number };
export type VideoAdapter = { submit(input: VideoInput): Promise<VideoSubmitOutput>; poll(providerTaskId: string, signal?: AbortSignal, model?: string): Promise<VideoPollOutput>; cancel?(providerTaskId: string, signal?: AbortSignal): Promise<void>; testConnection(model?: string): Promise<void> };
