import { OpenAiAsrAdapter } from './adapters/openai';
import { QwenAsrAdapter } from './adapters/qwen';
import { AzureAsrAdapter } from './adapters/azure';
import type { AsrAdapter, AsrProviderConfig, AsrProviderId } from './types';

export const ASR_PROVIDERS: Record<AsrProviderId, AsrProviderConfig> = {
  openai: { id: 'openai', name: 'OpenAI Whisper', defaultBaseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe' }, { id: 'gpt-4o-transcribe', name: 'GPT-4o Transcribe' }, { id: 'whisper-1', name: 'Whisper-1' }], defaultModel: 'gpt-4o-mini-transcribe', formats: ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4'], requiresApiKey: true },
  qwen: { id: 'qwen', name: '通义千问 ASR', defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1', models: [{ id: 'qwen3-asr-flash', name: 'Qwen3 ASR Flash' }], defaultModel: 'qwen3-asr-flash', formats: ['audio/wav', 'audio/webm', 'audio/mpeg'], requiresApiKey: true },
  azure: { id: 'azure', name: 'Azure Speech', defaultBaseUrl: 'https://eastus.api.cognitive.microsoft.com', models: [], defaultModel: '', formats: ['audio/wav', 'audio/webm', 'audio/mpeg'], requiresApiKey: true },
  lemonade: { id: 'lemonade', name: 'Lemonade', defaultBaseUrl: 'http://localhost:13305/v1', models: [{ id: 'Whisper-Base', name: 'Whisper Base' }, { id: 'Whisper-Large-v3', name: 'Whisper Large v3' }, { id: 'Whisper-Large-v3-Turbo', name: 'Whisper Large v3 Turbo' }, { id: 'Whisper-Medium', name: 'Whisper Medium' }, { id: 'Whisper-Small', name: 'Whisper Small' }, { id: 'Whisper-Tiny', name: 'Whisper Tiny' }], defaultModel: 'Whisper-Base', formats: ['audio/wav'], requiresApiKey: false },
};

export function createAsrAdapter(input: { providerId: AsrProviderId; apiKey: string; baseUrl?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }): AsrAdapter {
  const config = ASR_PROVIDERS[input.providerId];
  if (input.providerId === 'openai') return new OpenAiAsrAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'qwen') return new QwenAsrAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'azure') return new AzureAsrAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  return new OpenAiAsrAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl, defaultModel: config.defaultModel, requiresApiKey: config.requiresApiKey });
}
