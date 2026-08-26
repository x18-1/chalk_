import type { TtsAdapter, TtsProviderConfig, TtsProviderId } from './types';
import { OpenAiTtsAdapter } from './adapters/openai';
import { QwenTtsAdapter } from './adapters/qwen';
import { AzureTtsAdapter } from './adapters/azure';
import { MiniMaxTtsAdapter } from './adapters/minimax';
import { ElevenLabsTtsAdapter } from './adapters/elevenlabs';
import { DoubaoTtsAdapter } from './adapters/doubao';
import { VoxCpmTtsAdapter } from './adapters/voxcpm';

export const TTS_PROVIDERS: Record<TtsProviderId, TtsProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI TTS',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'gpt-4o-mini-tts', name: 'GPT-4o Mini TTS' }, { id: 'tts-1', name: 'TTS-1' }, { id: 'tts-1-hd', name: 'TTS-1 HD' }],
    defaultModel: 'gpt-4o-mini-tts',
    voices: ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'],
    formats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'], requiresApiKey: true,
  },
  qwen: {
    id: 'qwen',
    name: '通义千问 TTS',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    models: [{ id: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash' }, { id: 'qwen3-tts-instruct-flash', name: 'Qwen3 TTS Instruct Flash' }, { id: 'qwen-tts', name: 'Qwen TTS' }],
    defaultModel: 'qwen3-tts-flash',
    voices: ['Cherry', 'Serena', 'Ethan', 'Chelsie', 'Momo', 'Vivian'],
    formats: ['wav'], requiresApiKey: true,
  },
  azure: { id: 'azure', name: 'Azure TTS', defaultBaseUrl: 'https://eastus.tts.speech.microsoft.com', models: [], defaultModel: '', voices: ['zh-CN-XiaoxiaoNeural', 'en-US-JennyNeural'], formats: ['mp3'], requiresApiKey: true },
  minimax: { id: 'minimax', name: 'MiniMax TTS', defaultBaseUrl: 'https://api.minimaxi.com', models: [{ id: 'speech-2.8-hd', name: 'Speech 2.8 HD' }, { id: 'speech-2.8-turbo', name: 'Speech 2.8 Turbo' }, { id: 'speech-2.6-hd', name: 'Speech 2.6 HD' }, { id: 'speech-2.6-turbo', name: 'Speech 2.6 Turbo' }, { id: 'speech-02-hd', name: 'Speech 02 HD' }, { id: 'speech-02-turbo', name: 'Speech 02 Turbo' }], defaultModel: 'speech-2.8-hd', voices: ['female-yujie', 'male-qn-qingse'], formats: ['mp3', 'wav'], requiresApiKey: true },
  elevenlabs: { id: 'elevenlabs', name: 'ElevenLabs', defaultBaseUrl: 'https://api.elevenlabs.io/v1', models: [{ id: 'eleven_multilingual_v2', name: 'Multilingual v2' }, { id: 'eleven_flash_v2_5', name: 'Flash v2.5' }, { id: 'eleven_flash_v2', name: 'Flash v2' }], defaultModel: 'eleven_multilingual_v2', voices: ['EXAVITQu4vr4xnSDxMaL', '21m00Tcm4TlvDq8ikWAM'], formats: ['mp3', 'opus', 'wav'], requiresApiKey: true },
  glm: { id: 'glm', name: 'GLM TTS', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: [{ id: 'glm-tts', name: 'GLM TTS' }], defaultModel: 'glm-tts', voices: ['tongtong', 'chuichui'], formats: ['wav'], requiresApiKey: true },
  lemonade: { id: 'lemonade', name: 'Lemonade', defaultBaseUrl: 'http://localhost:13305/v1', models: [{ id: 'kokoro-v1', name: 'Kokoro v1' }], defaultModel: 'kokoro-v1', voices: ['af_heart'], formats: ['wav'], requiresApiKey: false },
  doubao: { id: 'doubao', name: 'Doubao TTS', defaultBaseUrl: 'https://openspeech.bytedance.com/api/v3/tts', models: [], defaultModel: '', voices: ['zh_female_vv_uranus_bigtts'], formats: ['mp3'], requiresApiKey: true },
  voxcpm: { id: 'voxcpm', name: 'VoxCPM2', defaultBaseUrl: 'http://localhost:8000', models: [{ id: 'voxcpm2', name: 'VoxCPM2' }], defaultModel: 'voxcpm2', voices: ['default'], formats: ['wav'], requiresApiKey: false },
};

export function createTtsAdapter(input: {
  providerId: TtsProviderId;
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): TtsAdapter {
  const config = TTS_PROVIDERS[input.providerId];
  if (input.providerId === 'openai') return new OpenAiTtsAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'qwen') return new QwenTtsAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'azure') return new AzureTtsAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'minimax') return new MiniMaxTtsAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'elevenlabs') return new ElevenLabsTtsAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'doubao') return new DoubaoTtsAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'voxcpm') return new VoxCpmTtsAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  return new OpenAiTtsAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl, defaultModel: config.defaultModel, requiresApiKey: config.requiresApiKey, defaultFormat: input.providerId === 'glm' || input.providerId === 'lemonade' ? 'wav' : undefined });
}
