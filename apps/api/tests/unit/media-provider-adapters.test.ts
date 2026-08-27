import { describe, expect, it, vi } from 'vitest';

import { QwenAsrAdapter } from '../../src/providers/asr/adapters/qwen';
import { QwenImageAdapter } from '../../src/providers/image/adapters/qwen';
import { SeedreamImageAdapter } from '../../src/providers/image/adapters/seedream';
import { LemonadeImageAdapter } from '../../src/providers/image/adapters/lemonade';
import { HappyHorseVideoAdapter } from '../../src/providers/video/adapters/happyhorse';
import { KlingVideoAdapter } from '../../src/providers/video/adapters/kling';
import { SeedanceVideoAdapter } from '../../src/providers/video/adapters/seedance';
import { VeoVideoAdapter } from '../../src/providers/video/adapters/veo';
import { QwenTtsAdapter } from '../../src/providers/tts/adapters/qwen';
import { DoubaoTtsAdapter } from '../../src/providers/tts/adapters/doubao';
import { ComfyUiImageAdapter } from '../../src/providers/image/adapters/comfyui';
import { SoraVideoAdapter } from '../../src/providers/video/adapters/sora';
import { VoxCpmTtsAdapter } from '../../src/providers/tts/adapters/voxcpm';
import { createTtsAdapter } from '../../src/providers/tts/providers';
import { createAsrAdapter } from '../../src/providers/asr/providers';
import { TTS_PROVIDERS } from '../../src/providers/tts/providers';
import { ASR_PROVIDERS } from '../../src/providers/asr/providers';
import { IMAGE_PROVIDERS } from '../../src/providers/image/providers';
import { VIDEO_PROVIDERS } from '../../src/providers/video/providers';

function json(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('OpenMAIC-compatible media adapters', () => {
  it('exposes model catalogs whose defaults are selectable', () => {
    for (const provider of [
      ...Object.values(TTS_PROVIDERS),
      ...Object.values(ASR_PROVIDERS),
      ...Object.values(IMAGE_PROVIDERS),
      ...Object.values(VIDEO_PROVIDERS),
    ]) {
      expect(provider).toHaveProperty('models');
      expect(provider.models.every((model) => model.id && model.name)).toBe(true);
      if (provider.defaultModel) {
        expect(provider.models.some((model) => model.id === provider.defaultModel)).toBe(true);
      }
    }
  });

  it('exposes the complete OpenMAIC model choices for versioned media providers', () => {
    expect(IMAGE_PROVIDERS.seedream.models.map((model) => model.id)).toEqual([
      'doubao-seedream-5-0-260128',
      'doubao-seedream-5-0-lite-260128',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-4-0-250828',
      'doubao-seedream-3-0-t2i-250415',
    ]);
    expect(IMAGE_PROVIDERS.openai.models.map((model) => model.id)).toContain('gpt-image-2-2026-04-21');
    expect(IMAGE_PROVIDERS.qwen.models.map((model) => model.id)).toEqual(expect.arrayContaining([
      'qwen-image-2.0-pro-2026-03-03',
      'qwen-image-2.0-2026-03-03',
      'qwen-image-max-2025-12-30',
      'qwen-image-plus-2026-01-09',
    ]));
    expect(VIDEO_PROVIDERS.seedance.models.map((model) => model.id)).toEqual(expect.arrayContaining([
      'doubao-seedance-1-0-pro-fast-251015',
      'doubao-seedance-1-0-lite-t2v-250428',
    ]));
  });

  it('publishes video aspect-ratio capabilities alongside model choices', () => {
    expect(VIDEO_PROVIDERS.seedance.aspectRatios).toEqual(['16:9', '4:3', '1:1', '9:16', '3:4', '21:9']);
    expect(VIDEO_PROVIDERS.happyhorse.aspectRatios).toContain('3:4');
  });

  it('keeps dynamic providers explicit instead of inventing static model ids', () => {
    expect(TTS_PROVIDERS.azure.models).toEqual([]);
    expect(TTS_PROVIDERS.doubao.models).toEqual([]);
    expect(IMAGE_PROVIDERS.comfyui.models).toEqual([]);
  });

  it('downloads Qwen TTS audio and normalizes it to WAV bytes', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ output: { audio: { url: 'https://cdn.test/audio.wav' } } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } }));
    const result = await new QwenTtsAdapter({ apiKey: 'key', baseUrl: 'https://dashscope.test', fetch: fetcher }).synthesize({ text: '你好', voice: 'Cherry', speed: 1.2 });
    expect([...result.bytes]).toEqual([82, 73, 70, 70]);
    expect(result.format).toBe('wav');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://dashscope.test/services/aigc/multimodal-generation/generation');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ parameters: { rate: 100 } });
  });

  it('sends Qwen ASR data URLs and extracts the transcript', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ output: { choices: [{ message: { content: [{ text: '三角形' }] } }] } }));
    const result = await new QwenAsrAdapter({ apiKey: 'key', baseUrl: 'https://dashscope.test', fetch: fetcher }).transcribe({ bytes: new Uint8Array([1, 2]), contentType: 'audio/wav', filename: 'a.wav', language: 'zh' });
    expect(result).toEqual({ text: '三角形', language: 'zh' });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).input.messages[0].content[0].audio).toBe('data:audio/wav;base64,AQI=');
  });

  it('normalizes a Qwen Image URL without leaking the upstream response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ output: { choices: [{ message: { content: [{ image: 'https://cdn.test/image.png' }] } }] } }));
    await expect(new QwenImageAdapter({ apiKey: 'key', baseUrl: 'https://dashscope.test', fetch: fetcher }).generate({ prompt: '课堂示意图', width: 1024, height: 576 })).resolves.toEqual({ kind: 'remote', url: 'https://cdn.test/image.png', contentType: 'image/png' });
  });

  it('uses valid Seedream 4.5 2K dimensions for each advertised aspect ratio', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ data: [{ b64_json: 'AQID' }] }));
    const adapter = new SeedreamImageAdapter({ apiKey: 'key', baseUrl: 'https://ark.test', fetch: fetcher });

    for (const aspectRatio of IMAGE_PROVIDERS.seedream.aspectRatios) {
      await adapter.generate({
        prompt: '课堂示意图',
        model: 'doubao-seedream-4-5-251128',
        aspectRatio,
      });
    }

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ size: '2560x1440' });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ size: '2304x1728' });
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toMatchObject({ size: '2048x2048' });
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toMatchObject({ size: '1440x2560' });
  });

  it('uses Lemonade OpenAI-compatible image generation and accepts base64 output', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ b64_json: 'AQID' }] }));
    const result = await new LemonadeImageAdapter({ baseUrl: 'http://lemonade.test/v1', fetch: fetcher }).generate({ prompt: '课堂示意图', model: 'Qwen-Image-GGUF', width: 1024, height: 576 });
    expect(result).toEqual({ kind: 'bytes', bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://lemonade.test/v1/images/generations');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model: 'Qwen-Image-GGUF', size: '1024x576', response_format: 'b64_json' });
  });

  it('preserves HappyHorse submit and poll task semantics', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ output: { task_id: 'task-1' } }))
      .mockResolvedValueOnce(json({ output: { task_status: 'RUNNING' } }))
      .mockResolvedValueOnce(json({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.test/video.mp4' } }));
    const adapter = new HappyHorseVideoAdapter({ apiKey: 'key', baseUrl: 'https://dashscope.test', fetch: fetcher });
    await expect(adapter.submit({ prompt: '画出一条抛物线', durationSeconds: 5 })).resolves.toEqual({ providerTaskId: 'task-1' });
    await expect(adapter.poll('task-1')).resolves.toEqual({ status: 'pending' });
    await expect(adapter.poll('task-1')).resolves.toMatchObject({ status: 'done', url: 'https://cdn.test/video.mp4', contentType: 'video/mp4' });
  });

  it('normalizes Seedance submit and poll responses', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 'seed-task' }))
      .mockResolvedValueOnce(json({ status: 'succeeded', ratio: '16:9', resolution: '720p', duration: 5, content: { video_url: 'https://cdn.test/seed.mp4' } }));
    const adapter = new SeedanceVideoAdapter({ apiKey: 'key', baseUrl: 'https://ark.test', fetch: fetcher });
    await expect(adapter.submit({ prompt: '画一段动画', aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' })).resolves.toEqual({ providerTaskId: 'seed-task' });
    await expect(adapter.poll('seed-task')).resolves.toMatchObject({ status: 'done', url: 'https://cdn.test/seed.mp4', contentType: 'video/mp4' });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ ratio: '16:9', duration: 5, resolution: '720p' });
  });

  it('signs Kling requests and normalizes a completed task', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ code: 0, data: { task_id: 'kling-task' } }))
      .mockResolvedValueOnce(json({ code: 0, data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.test/kling.mp4', duration: '5' }] } } }));
    const adapter = new KlingVideoAdapter({ apiKey: 'access:secret', baseUrl: 'https://kling.test', fetch: fetcher });
    await expect(adapter.submit({ prompt: '画一段动画' })).resolves.toEqual({ providerTaskId: 'kling-task' });
    await expect(adapter.poll('kling-task')).resolves.toMatchObject({ status: 'done', url: 'https://cdn.test/kling.mp4', durationSeconds: 5 });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/) });
  });

  it('decodes Veo inline video bytes from the OpenMAIC response shape', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ name: 'operations/veo-task' }))
      .mockResolvedValueOnce(json({ done: true, response: { videos: [{ bytesBase64Encoded: 'AQID', mimeType: 'video/mp4' }] } }));
    const adapter = new VeoVideoAdapter({ apiKey: 'key', baseUrl: 'https://veo.test', fetch: fetcher });
    await expect(adapter.submit({ prompt: '画一段动画' })).resolves.toEqual({ providerTaskId: 'operations/veo-task' });
    await expect(adapter.poll('operations/veo-task', undefined, 'veo-3.0-generate-001')).resolves.toEqual({ status: 'done', url: 'data:video/mp4;base64,AQID', contentType: 'video/mp4' });
    expect(fetcher.mock.calls[1]?.[0]).toContain('/veo-3.0-generate-001:fetchPredictOperation');
  });

  it('uses provider defaults for OpenAI-compatible GLM and Lemonade TTS', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'audio/wav' } }));
    await createTtsAdapter({ providerId: 'glm', apiKey: 'key', fetch: fetcher }).synthesize({ text: '测试', voice: 'tongtong' });
    await createTtsAdapter({ providerId: 'lemonade', apiKey: '', fetch: fetcher }).synthesize({ text: 'test', voice: 'af_heart' });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model: 'glm-tts', response_format: 'wav' });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ model: 'kokoro-v1', response_format: 'wav' });
  });

  it('uses the configured Lemonade ASR model and exposes it to connection checks', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ text: 'test' }));
    const adapter = createAsrAdapter({ providerId: 'lemonade', apiKey: '', fetch: fetcher });
    await adapter.transcribe({ bytes: new Uint8Array([1]), contentType: 'audio/wav', filename: 'a.wav', model: 'Whisper-Large-v3' });
    expect((fetcher.mock.calls[0]?.[1]?.body as FormData).get('model')).toBe('Whisper-Large-v3');
    await adapter.testConnection('Whisper-Large-v3');
    expect(fetcher.mock.calls[1]?.[0]).toBe('http://localhost:13305/v1/models');
  });

  it('probes Doubao credentials during connection testing', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(new DoubaoTtsAdapter({ apiKey: 'app:access', baseUrl: 'https://doubao.test/api/v3/tts', fetch: fetcher }).testConnection()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith('https://doubao.test/api/v3/tts/unidirectional', expect.objectContaining({ method: 'POST' }));
  });

  it('patches a ComfyUI workflow and downloads its completed image', async () => {
    const workflow = {
      '1': { _meta: { title: 'Input Prompt' }, inputs: { value: '' } },
      '2': { _meta: { title: 'Width' }, inputs: { value: 512 } },
      '3': { _meta: { title: 'Height' }, inputs: { value: 512 } },
      '4': { _meta: { title: 'KSampler' }, inputs: { seed: 1 } },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ prompt_id: 'prompt-1' }))
      .mockResolvedValueOnce(json({ 'prompt-1': { status: { completed: true, status_str: 'success' }, outputs: { '5': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } }));
    const adapter = new ComfyUiImageAdapter({ baseUrl: 'http://comfy.test', fetch: fetcher, pollIntervalMs: 0, workflowJson: workflow });
    await expect(adapter.generate({ prompt: '一张课堂示意图', width: 1024, height: 576 })).resolves.toEqual({ kind: 'bytes', bytes: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.prompt['1'].inputs.value).toBe('一张课堂示意图');
    expect(body.prompt['2'].inputs.value).toBe(1024);
    expect(body.prompt['3'].inputs.value).toBe(576);
  });

  it('submits, polls, and downloads a Sora video', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 'video-1', status: 'queued' }))
      .mockResolvedValueOnce(json({ id: 'video-1', status: 'in_progress' }))
      .mockResolvedValueOnce(json({ id: 'video-1', status: 'completed', seconds: 8 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 24]), { status: 200, headers: { 'content-type': 'video/mp4' } }));
    const adapter = new SoraVideoAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.test/v1', fetch: fetcher });
    await expect(adapter.submit({ prompt: '一架纸飞机', model: 'sora-2', durationSeconds: 8, aspectRatio: '16:9', resolution: '720p' })).resolves.toEqual({ providerTaskId: 'video-1' });
    const form = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('model')).toBe('sora-2');
    expect(form.get('seconds')).toBe('8');
    await expect(adapter.poll('video-1')).resolves.toEqual({ status: 'pending' });
    await expect(adapter.poll('video-1')).resolves.toMatchObject({ status: 'done', contentType: 'video/mp4', bytes: new Uint8Array([0, 0, 0, 24]), durationSeconds: 8 });
  });

  it('uses the VoxCPM vLLM-Omni request shape with voice prompt context', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'content-type': 'audio/wav' } }));
    const adapter = new VoxCpmTtsAdapter({ baseUrl: 'http://voxcpm.test', fetch: fetcher });
    await expect(adapter.synthesize({ text: '你好', voice: 'default', providerOptions: { backend: 'vllm-omni', voicePrompt: '温和的老师' } })).resolves.toMatchObject({ format: 'wav', contentType: 'audio/wav' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://voxcpm.test/v1/audio/speech');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model: 'voxcpm2', input: '(温和的老师)你好', voice: 'default', response_format: 'wav' });
  });
});
