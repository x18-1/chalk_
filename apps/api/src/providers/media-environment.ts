export type MediaCapability = 'tts' | 'asr' | 'image' | 'video';

type EnvironmentBinding = {
  apiKey?: readonly string[];
  baseUrl?: readonly string[];
};

const bindings: Record<MediaCapability, Record<string, EnvironmentBinding>> = {
  tts: {
    openai: { apiKey: ['TTS_OPENAI_API_KEY', 'OPENAI_API_KEY'], baseUrl: ['TTS_OPENAI_BASE_URL'] },
    qwen: { apiKey: ['TTS_QWEN_API_KEY', 'QWEN_API_KEY'], baseUrl: ['TTS_QWEN_BASE_URL'] },
    azure: { apiKey: ['TTS_AZURE_API_KEY'], baseUrl: ['TTS_AZURE_BASE_URL'] },
    minimax: { apiKey: ['TTS_MINIMAX_API_KEY', 'MINIMAX_API_KEY'], baseUrl: ['TTS_MINIMAX_BASE_URL'] },
    elevenlabs: { apiKey: ['TTS_ELEVENLABS_API_KEY'], baseUrl: ['TTS_ELEVENLABS_BASE_URL'] },
    glm: { apiKey: ['TTS_GLM_API_KEY', 'GLM_API_KEY'], baseUrl: ['TTS_GLM_BASE_URL'] },
    lemonade: { baseUrl: ['TTS_LEMONADE_BASE_URL'] },
  },
  asr: {
    openai: { apiKey: ['ASR_OPENAI_API_KEY', 'OPENAI_API_KEY'], baseUrl: ['ASR_OPENAI_BASE_URL'] },
    qwen: { apiKey: ['ASR_QWEN_API_KEY', 'QWEN_API_KEY'], baseUrl: ['ASR_QWEN_BASE_URL'] },
    azure: { apiKey: ['ASR_AZURE_API_KEY'], baseUrl: ['ASR_AZURE_BASE_URL'] },
    lemonade: { baseUrl: ['ASR_LEMONADE_BASE_URL'] },
  },
  image: {
    openai: { apiKey: ['IMAGE_OPENAI_API_KEY', 'OPENAI_API_KEY'], baseUrl: ['IMAGE_OPENAI_BASE_URL'] },
    seedream: { apiKey: ['IMAGE_SEEDREAM_API_KEY', 'ARK_API_KEY'], baseUrl: ['IMAGE_SEEDREAM_BASE_URL'] },
    qwen: { apiKey: ['IMAGE_QWEN_IMAGE_API_KEY', 'QWEN_API_KEY'], baseUrl: ['IMAGE_QWEN_IMAGE_BASE_URL'] },
    'nano-banana': { apiKey: ['IMAGE_NANO_BANANA_API_KEY', 'GOOGLE_API_KEY'], baseUrl: ['IMAGE_NANO_BANANA_BASE_URL'] },
    minimax: { apiKey: ['IMAGE_MINIMAX_API_KEY', 'MINIMAX_API_KEY'], baseUrl: ['IMAGE_MINIMAX_BASE_URL'] },
    grok: { apiKey: ['IMAGE_GROK_API_KEY', 'GROK_API_KEY'], baseUrl: ['IMAGE_GROK_BASE_URL'] },
    lemonade: { baseUrl: ['IMAGE_LEMONADE_BASE_URL'] },
  },
  video: {
    seedance: { apiKey: ['VIDEO_SEEDANCE_API_KEY', 'ARK_API_KEY'], baseUrl: ['VIDEO_SEEDANCE_BASE_URL'] },
    kling: { apiKey: ['VIDEO_KLING_API_KEY'], baseUrl: ['VIDEO_KLING_BASE_URL'] },
    veo: { apiKey: ['VIDEO_VEO_API_KEY', 'GOOGLE_API_KEY'], baseUrl: ['VIDEO_VEO_BASE_URL'] },
    sora: { apiKey: ['VIDEO_SORA_API_KEY', 'OPENAI_API_KEY'], baseUrl: ['VIDEO_SORA_BASE_URL'] },
    minimax: { apiKey: ['VIDEO_MINIMAX_API_KEY', 'MINIMAX_API_KEY'], baseUrl: ['VIDEO_MINIMAX_BASE_URL'] },
    grok: { apiKey: ['VIDEO_GROK_API_KEY', 'GROK_API_KEY'], baseUrl: ['VIDEO_GROK_BASE_URL'] },
    happyhorse: { apiKey: ['VIDEO_HAPPYHORSE_API_KEY'], baseUrl: ['VIDEO_HAPPYHORSE_BASE_URL'] },
  },
};

export function resolveMediaEnvironment(
  capability: MediaCapability,
  providerId: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const binding = bindings[capability][providerId];
  return {
    apiKey: firstValue(binding?.apiKey, environment),
    baseUrl: firstValue(binding?.baseUrl, environment),
  };
}

function firstValue(names: readonly string[] | undefined, environment: NodeJS.ProcessEnv) {
  for (const name of names ?? []) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return undefined;
}
