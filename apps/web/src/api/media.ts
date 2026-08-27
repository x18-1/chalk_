import { apiJson } from './client';

export type MediaCapability = 'tts' | 'asr' | 'image' | 'video';
export type ProviderModel = { id: string; name: string };
export type MediaProvider = { capability: MediaCapability; id: string; name: string; defaultBaseUrl: string; models: ProviderModel[]; defaultModel: string; baseUrl: string; configured: boolean; credentialSource: 'user' | 'environment' | 'none'; canRemoveCredential: boolean; requiresApiKey: boolean; voices?: string[]; formats?: string[]; aspectRatios?: string[]; durations?: number[]; resolutions?: string[]; settings?: { backend?: string; workflowId?: string; modelId?: string } };
export type MediaProviders = Record<MediaCapability, MediaProvider[]>;

export const mediaApi = {
  providers() {
    return apiJson<MediaProviders>('/media/providers');
  },
  saveCredential(capability: MediaCapability, providerId: string, input: { apiKey?: string; baseUrl?: string; settings?: { backend?: string; workflowId?: string; modelId?: string } }) {
    return apiJson<{ capability: MediaCapability; providerId: string; configured: boolean; credentialSource: 'user' | 'environment' | 'none'; canRemoveCredential: boolean; baseUrl: string }>(`/media/providers/${capability}/${encodeURIComponent(providerId)}/credential`, { method: 'PUT', body: JSON.stringify(input) });
  },
  removeCredential(capability: MediaCapability, providerId: string) {
    return apiJson<{ capability: MediaCapability; providerId: string; configured: boolean; credentialSource: 'environment' | 'none'; canRemoveCredential: false }>(`/media/providers/${capability}/${encodeURIComponent(providerId)}/credential`, { method: 'DELETE' });
  },
  test(capability: MediaCapability, providerId: string, model?: string) {
    return apiJson<{ ok: true; capability: MediaCapability; providerId: string }>(`/media/providers/${capability}/${encodeURIComponent(providerId)}/test`, { method: 'POST', body: JSON.stringify(model ? { model } : {}) });
  },
  synthesize(input: { providerId: string; text: string; voice: string; model?: string; speed?: number; format?: string; providerOptions?: { backend?: 'vllm-omni' | 'python-api' | 'nano-vllm'; voicePrompt?: string; promptText?: string; referenceAudioBase64?: string; referenceAudioMimeType?: string; referenceAudioName?: string; registeredVoiceId?: string; cfgValue?: number; inferenceTimesteps?: number; normalize?: boolean; denoise?: boolean } }) {
    return apiJson<{ audioBase64: string; contentType: string; format: string }>('/media/tts', { method: 'POST', body: JSON.stringify(input) });
  },
  transcribe(input: { providerId: string; audioBase64: string; contentType: string; filename: string; model?: string; language?: string }) {
    return apiJson<{ text: string; language?: string }>('/media/asr', { method: 'POST', body: JSON.stringify(input) });
  },
  generateImage(input: { providerId: string; prompt: string; model?: string; width?: number; height?: number; aspectRatio?: string; workflowJson?: Record<string, unknown> }) {
    return apiJson<{ kind: 'remote' | 'bytes'; url?: string; imageBase64?: string; contentType?: string }>('/media/image', { method: 'POST', body: JSON.stringify(input) });
  },
  videoTasks(input: { providerId: string; prompt: string; model?: string; aspectRatio?: string; durationSeconds?: number; resolution?: string }) {
    return apiJson<{ task: { providerTaskId: string; model?: string } }>('/media/video/tasks', { method: 'POST', body: JSON.stringify(input) });
  },
  videoTask(providerId: string, taskId: string, model?: string) {
    const query = model ? `?model=${encodeURIComponent(model)}` : '';
    return apiJson<{ task: { status: 'pending' | 'failed' | 'done'; url?: string; videoBase64?: string; contentType?: string; error?: { message?: string } } }>(`/media/video/tasks/${encodeURIComponent(providerId)}/${encodeURIComponent(taskId)}${query}`);
  },
  comfyWorkflows() {
    return apiJson<{ workflows: Array<{ id: string; name: string }> }>('/media/image/comfyui/workflows');
  },
};
