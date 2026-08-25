import { z } from 'zod';

export const mediaCapabilitySchema = z.enum(['tts', 'asr', 'image', 'video']);
export const mediaProviderParamsSchema = z.object({ capability: mediaCapabilitySchema, providerId: z.string().min(1).max(100) });
export const mediaTestSchema = z.object({ model: z.string().trim().min(1).max(200).optional() });
export const mediaCredentialSchema = z.object({ apiKey: z.string().trim().max(10_000).optional(), baseUrl: z.string().trim().url().max(2_000).optional(), settings: z.object({ backend: z.enum(['vllm-omni', 'python-api', 'nano-vllm']).optional(), workflowId: z.string().trim().max(200).optional(), modelId: z.string().trim().max(200).optional() }).optional() }).refine((value) => Boolean(value.apiKey || value.baseUrl || value.settings), 'apiKey, baseUrl or settings is required');

export const ttsRequestSchema = z.object({
  providerId: z.enum(['openai', 'qwen', 'azure', 'minimax', 'elevenlabs', 'glm', 'lemonade', 'doubao', 'voxcpm']),
  text: z.string().trim().min(1).max(20_000),
  voice: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200).optional(),
  speed: z.number().finite().min(0.25).max(4).optional(),
  format: z.enum(['mp3', 'opus', 'wav', 'aac', 'flac', 'pcm']).optional(),
  providerOptions: z.object({
    backend: z.enum(['vllm-omni', 'python-api', 'nano-vllm']).optional(),
    voicePrompt: z.string().max(2_000).optional(),
    promptText: z.string().max(20_000).optional(),
    referenceAudioBase64: z.string().max(20_000_000).optional(),
    referenceAudioMimeType: z.string().max(100).optional(),
    referenceAudioName: z.string().max(200).optional(),
    registeredVoiceId: z.string().max(200).optional(),
    cfgValue: z.number().finite().min(0).max(20).optional(),
    inferenceTimesteps: z.number().int().min(1).max(100).optional(),
    normalize: z.boolean().optional(),
    denoise: z.boolean().optional(),
  }).optional(),
});

export const asrRequestSchema = z.object({
  providerId: z.enum(['openai', 'qwen', 'azure', 'lemonade']),
  audioBase64: z.string().min(1).max(20_000_000),
  contentType: z.string().trim().min(3).max(100),
  filename: z.string().trim().min(1).max(200).default('recording.wav'),
  model: z.string().trim().min(1).max(200).optional(),
  language: z.string().trim().min(2).max(20).optional(),
});

export const imageRequestSchema = z.object({
  providerId: z.enum(['openai', 'qwen', 'seedream', 'minimax', 'grok', 'nano-banana', 'comfyui', 'lemonade']),
  prompt: z.string().trim().min(1).max(32_000),
  model: z.string().trim().min(1).max(200).optional(),
  width: z.number().int().min(256).max(4096).optional(),
  height: z.number().int().min(256).max(4096).optional(),
  aspectRatio: z.enum(['16:9', '4:3', '1:1', '9:16', '3:4', '21:9']).optional(),
  negativePrompt: z.string().trim().max(4_000).optional(),
  workflowJson: z.record(z.string(), z.unknown()).optional(),
});

export const videoSubmitSchema = z.object({
  providerId: z.enum(['happyhorse', 'grok', 'minimax', 'seedance', 'kling', 'veo', 'sora']),
  prompt: z.string().trim().min(1).max(32_000),
  model: z.string().trim().min(1).max(200).optional(),
  aspectRatio: z.enum(['16:9', '4:3', '1:1', '9:16', '3:4', '21:9']).optional(),
  durationSeconds: z.number().int().min(5).max(20).optional(),
  resolution: z.enum(['720p', '1080p']).optional(),
});

export const videoTaskParamsSchema = z.object({ providerId: z.enum(['happyhorse', 'grok', 'minimax', 'seedance', 'kling', 'veo', 'sora']), taskId: z.string().trim().min(1).max(500) });
export const videoTaskQuerySchema = z.object({ model: z.string().trim().min(1).max(200).optional() });

export type TtsRequest = z.infer<typeof ttsRequestSchema>;
export type AsrRequest = z.infer<typeof asrRequestSchema>;
export type ImageRequest = z.infer<typeof imageRequestSchema>;
export type VideoSubmitRequest = z.infer<typeof videoSubmitSchema>;
