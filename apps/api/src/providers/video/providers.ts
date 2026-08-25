import { HappyHorseVideoAdapter } from './adapters/happyhorse';
import { GrokVideoAdapter } from './adapters/grok';
import { MiniMaxVideoAdapter } from './adapters/minimax';
import { SeedanceVideoAdapter } from './adapters/seedance';
import { KlingVideoAdapter } from './adapters/kling';
import { VeoVideoAdapter } from './adapters/veo';
import { SoraVideoAdapter } from './adapters/sora';
import type { VideoAdapter, VideoProviderConfig, VideoProviderId } from './types';

export const VIDEO_PROVIDERS: Record<VideoProviderId, VideoProviderConfig> = {
  happyhorse: { id: 'happyhorse', name: 'HappyHorse', defaultBaseUrl: 'https://dashscope.aliyuncs.com', models: [{ id: 'happyhorse-1.0-t2v', name: 'HappyHorse 1.0 T2V' }], defaultModel: 'happyhorse-1.0-t2v', async: true, aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'], durations: [5, 10, 15], resolutions: ['720p', '1080p'], requiresApiKey: true },
  grok: { id: 'grok', name: 'Grok Video', defaultBaseUrl: 'https://api.x.ai/v1', models: [{ id: 'grok-imagine-video', name: 'Grok Imagine Video' }], defaultModel: 'grok-imagine-video', async: true, aspectRatios: ['16:9', '1:1', '9:16'], durations: [6], resolutions: ['720p'], requiresApiKey: true },
  minimax: { id: 'minimax', name: 'MiniMax Video', defaultBaseUrl: 'https://api.minimaxi.com', models: [{ id: 'MiniMax-Hailuo-2.3', name: 'Hailuo 2.3' }, { id: 'MiniMax-Hailuo-02', name: 'Hailuo 02' }, { id: 'T2V-01-Director', name: 'T2V-01 Director' }, { id: 'T2V-01', name: 'T2V-01' }], defaultModel: 'MiniMax-Hailuo-2.3', async: true, aspectRatios: ['16:9', '4:3', '1:1', '9:16'], durations: [6, 10], resolutions: ['720p', '1080p'], requiresApiKey: true },
  seedance: { id: 'seedance', name: 'Seedance', defaultBaseUrl: 'https://ark.cn-beijing.volces.com', models: [{ id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0' }, { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast' }, { id: 'doubao-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini' }, { id: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro' }, { id: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro' }, { id: 'doubao-seedance-1-0-pro-fast-251015', name: 'Seedance 1.0 Pro Fast' }, { id: 'doubao-seedance-1-0-lite-t2v-250428', name: 'Seedance 1.0 Lite T2V' }], defaultModel: 'doubao-seedance-2-0-260128', async: true, aspectRatios: ['16:9', '4:3', '1:1', '9:16', '3:4', '21:9'], durations: [5, 10], resolutions: ['480p', '720p', '1080p'], requiresApiKey: true },
  kling: { id: 'kling', name: 'Kling', defaultBaseUrl: 'https://api-beijing.klingai.com', models: [{ id: 'kling-v2-6', name: 'Kling V2.6' }, { id: 'kling-v1-6', name: 'Kling V1.6' }], defaultModel: 'kling-v2-6', async: true, aspectRatios: ['16:9', '1:1', '9:16'], durations: [5, 10], resolutions: ['720p'], requiresApiKey: true },
  veo: { id: 'veo', name: 'Veo', defaultBaseUrl: 'https://generativelanguage.googleapis.com', models: [{ id: 'veo-3.1-fast-generate-001', name: 'Veo 3.1 Fast' }, { id: 'veo-3.1-generate-001', name: 'Veo 3.1' }, { id: 'veo-3.0-fast-generate-001', name: 'Veo 3.0 Fast' }, { id: 'veo-3.0-generate-001', name: 'Veo 3.0' }, { id: 'veo-2.0-generate-001', name: 'Veo 2.0' }], defaultModel: 'veo-3.1-fast-generate-001', async: true, aspectRatios: ['16:9', '1:1', '9:16'], durations: [8], resolutions: ['720p'], requiresApiKey: true },
  sora: { id: 'sora', name: 'Sora', defaultBaseUrl: 'https://api.openai.com/v1', models: [{ id: 'sora-2', name: 'Sora 2' }, { id: 'sora-2-pro', name: 'Sora 2 Pro' }], defaultModel: 'sora-2', async: true, aspectRatios: ['16:9', '1:1', '9:16'], durations: [8, 16, 20], resolutions: ['720p', '1080p'], requiresApiKey: true },
};

export function createVideoAdapter(input: { providerId: VideoProviderId; apiKey: string; baseUrl?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }): VideoAdapter {
  const config = VIDEO_PROVIDERS[input.providerId];
  if (input.providerId === 'happyhorse') return new HappyHorseVideoAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'grok') return new GrokVideoAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'minimax') return new MiniMaxVideoAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'seedance') return new SeedanceVideoAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'kling') return new KlingVideoAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'sora') return new SoraVideoAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  return new VeoVideoAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
}
