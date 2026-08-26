import type { ProviderError } from '../provider-error';
import type { ProviderModel } from '../model';

export type ImageProviderId = 'openai' | 'qwen' | 'seedream' | 'minimax' | 'grok' | 'nano-banana' | 'comfyui' | 'lemonade';
export type ImageProviderConfig = { id: ImageProviderId; name: string; defaultBaseUrl: string; models: readonly ProviderModel[]; defaultModel: string; aspectRatios: readonly string[]; requiresApiKey: boolean };
export type ImageInput = { prompt: string; model?: string; width?: number; height?: number; aspectRatio?: string; negativePrompt?: string; workflowJson?: Record<string, unknown>; signal?: AbortSignal };
export type ImageOutput = { kind: 'remote'; url: string; contentType?: string } | { kind: 'bytes'; bytes: Uint8Array; contentType: string };
export type ImageAdapter = { generate(input: ImageInput): Promise<ImageOutput>; testConnection(model?: string): Promise<void> };
export type ImageFailure = ProviderError;
