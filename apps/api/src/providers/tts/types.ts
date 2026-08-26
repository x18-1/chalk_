import type { ProviderError } from '../provider-error';
import type { ProviderModel } from '../model';

export type TtsProviderId = 'openai' | 'qwen' | 'azure' | 'minimax' | 'elevenlabs' | 'glm' | 'lemonade' | 'doubao' | 'voxcpm';
export type TtsFormat = 'mp3' | 'opus' | 'wav' | 'aac' | 'flac' | 'pcm';

export type TtsProviderConfig = {
  id: TtsProviderId;
  name: string;
  defaultBaseUrl: string;
  models: readonly ProviderModel[];
  defaultModel: string;
  voices: readonly string[];
  formats: readonly TtsFormat[];
  requiresApiKey: boolean;
};

export type TtsInput = {
  text: string;
  voice: string;
  model?: string;
  speed?: number;
  format?: TtsFormat;
  signal?: AbortSignal;
  providerOptions?: VoxCpmOptions;
};

export type TtsOutput = {
  bytes: Uint8Array;
  format: TtsFormat;
  contentType: string;
};

export type TtsAdapter = {
  synthesize(input: TtsInput): Promise<TtsOutput>;
  testConnection(model?: string): Promise<void>;
};

export type TtsFailure = ProviderError;

export type VoxCpmBackend = 'vllm-omni' | 'python-api' | 'nano-vllm';
export type VoxCpmOptions = {
  backend?: VoxCpmBackend;
  voicePrompt?: string;
  promptText?: string;
  referenceAudioBase64?: string;
  referenceAudioMimeType?: string;
  referenceAudioName?: string;
  registeredVoiceId?: string;
  cfgValue?: number;
  inferenceTimesteps?: number;
  normalize?: boolean;
  denoise?: boolean;
};
