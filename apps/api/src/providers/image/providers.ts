import { OpenAiImageAdapter } from './adapters/openai';
import { QwenImageAdapter } from './adapters/qwen';
import { SeedreamImageAdapter } from './adapters/seedream';
import { MiniMaxImageAdapter } from './adapters/minimax';
import { GrokImageAdapter } from './adapters/grok';
import { NanoBananaImageAdapter } from './adapters/nano-banana';
import { ComfyUiImageAdapter } from './adapters/comfyui';
import { LemonadeImageAdapter } from './adapters/lemonade';
import type { ImageAdapter, ImageProviderConfig, ImageProviderId } from './types';

export const IMAGE_PROVIDERS: Record<ImageProviderId, ImageProviderConfig> = {
  openai: { id: 'openai', name: 'OpenAI Image', defaultBaseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-image-2', name: 'GPT Image 2' }, { id: 'gpt-image-2-2026-04-21', name: 'GPT Image 2 (2026-04-21)' }, { id: 'gpt-image-1.5', name: 'GPT Image 1.5' }, { id: 'gpt-image-1', name: 'GPT Image 1' }, { id: 'gpt-image-1-mini', name: 'GPT Image 1 Mini' }, { id: 'chatgpt-image-latest', name: 'ChatGPT Image Latest' }], defaultModel: 'gpt-image-1.5', aspectRatios: ['16:9', '4:3', '1:1', '9:16'], requiresApiKey: true },
  qwen: { id: 'qwen', name: '通义千问 Image', defaultBaseUrl: 'https://dashscope.aliyuncs.com', models: [{ id: 'qwen-image-2.0-pro', name: 'Qwen Image 2.0 Pro' }, { id: 'qwen-image-2.0-pro-2026-03-03', name: 'Qwen Image 2.0 Pro (2026-03-03)' }, { id: 'qwen-image-2.0', name: 'Qwen Image 2.0' }, { id: 'qwen-image-2.0-2026-03-03', name: 'Qwen Image 2.0 (2026-03-03)' }, { id: 'qwen-image-max', name: 'Qwen Image Max' }, { id: 'qwen-image-max-2025-12-30', name: 'Qwen Image Max (2025-12-30)' }, { id: 'qwen-image-plus', name: 'Qwen Image Plus' }, { id: 'qwen-image-plus-2026-01-09', name: 'Qwen Image Plus (2026-01-09)' }, { id: 'qwen-image', name: 'Qwen Image' }, { id: 'z-image-turbo', name: 'Z-Image Turbo' }], defaultModel: 'qwen-image-max', aspectRatios: ['16:9', '4:3', '1:1', '9:16'], requiresApiKey: true },
  seedream: { id: 'seedream', name: 'Seedream', defaultBaseUrl: 'https://ark.cn-beijing.volces.com', models: [{ id: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0 Lite' }, { id: 'doubao-seedream-5-0-lite-260128', name: 'Seedream 5.0 Lite (Alias)' }, { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5' }, { id: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0' }, { id: 'doubao-seedream-3-0-t2i-250415', name: 'Seedream 3.0' }], defaultModel: 'doubao-seedream-4-5-251128', aspectRatios: ['16:9', '4:3', '1:1', '9:16'], requiresApiKey: true },
  minimax: { id: 'minimax', name: 'MiniMax Image', defaultBaseUrl: 'https://api.minimaxi.com', models: [{ id: 'image-01', name: 'Image 01' }, { id: 'image-01-live', name: 'Image 01 Live' }], defaultModel: 'image-01', aspectRatios: ['16:9', '4:3', '1:1', '9:16'], requiresApiKey: true },
  grok: { id: 'grok', name: 'Grok Image', defaultBaseUrl: 'https://api.x.ai/v1', models: [{ id: 'grok-imagine-image', name: 'Grok Imagine Image' }, { id: 'grok-imagine-image-pro', name: 'Grok Imagine Image Pro' }], defaultModel: 'grok-imagine-image', aspectRatios: ['16:9', '4:3', '1:1', '9:16'], requiresApiKey: true },
  'nano-banana': { id: 'nano-banana', name: 'Nano Banana', defaultBaseUrl: 'https://generativelanguage.googleapis.com', models: [{ id: 'gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image' }, { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image' }, { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' }], defaultModel: 'gemini-2.5-flash-image', aspectRatios: ['16:9', '4:3', '1:1'], requiresApiKey: true },
  comfyui: { id: 'comfyui', name: 'ComfyUI Image', defaultBaseUrl: 'http://localhost:8188', models: [], defaultModel: '', aspectRatios: ['16:9', '4:3', '1:1', '9:16'], requiresApiKey: false },
  lemonade: { id: 'lemonade', name: 'Lemonade', defaultBaseUrl: 'http://localhost:13305/v1', models: [{ id: 'Qwen-Image-GGUF', name: 'Qwen Image GGUF' }, { id: 'sd-cpp', name: 'Stable Diffusion (sd-cpp)' }], defaultModel: 'Qwen-Image-GGUF', aspectRatios: ['16:9', '4:3', '1:1', '9:16'], requiresApiKey: false },
};

export function createImageAdapter(input: { providerId: ImageProviderId; apiKey: string; baseUrl?: string; workflowJson?: Record<string, unknown>; fetch?: typeof globalThis.fetch; timeoutMs?: number }): ImageAdapter {
  const config = IMAGE_PROVIDERS[input.providerId];
  if (input.providerId === 'openai') return new OpenAiImageAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'seedream') return new SeedreamImageAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'qwen') return new QwenImageAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'minimax') return new MiniMaxImageAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'grok') return new GrokImageAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  if (input.providerId === 'comfyui') return new ComfyUiImageAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl, workflowJson: input.workflowJson });
  if (input.providerId === 'lemonade') return new LemonadeImageAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
  return new NanoBananaImageAdapter({ ...input, baseUrl: input.baseUrl ?? config.defaultBaseUrl });
}
