import { QwenAsrAdapter } from '../src/providers/asr/adapters/qwen';
import { QwenImageAdapter } from '../src/providers/image/adapters/qwen';
import { HappyHorseVideoAdapter } from '../src/providers/video/adapters/happyhorse';
import { QwenTtsAdapter } from '../src/providers/tts/adapters/qwen';

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
  console.error('DASHSCOPE_API_KEY is required for the Alibaba media smoke test');
  process.exit(2);
}

const baseUrl = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/api/v1';
const tts = new QwenTtsAdapter({ apiKey, baseUrl });
const asr = new QwenAsrAdapter({ apiKey, baseUrl });
const image = new QwenImageAdapter({ apiKey, baseUrl: baseUrl.replace(/\/api\/v1$/, '') });
const video = new HappyHorseVideoAdapter({ apiKey, baseUrl: baseUrl.replace(/\/api\/v1$/, '') });

const speech = await tts.synthesize({ text: '这是 Chalk 的媒体 Provider smoke test。', voice: 'Cherry' });
console.log(`tts ok: ${speech.format}, ${speech.bytes.byteLength} bytes`);

if (process.env.MEDIA_SMOKE_AUDIO_BASE64) {
  const transcript = await asr.transcribe({ bytes: Uint8Array.from(Buffer.from(process.env.MEDIA_SMOKE_AUDIO_BASE64, 'base64')), contentType: process.env.MEDIA_SMOKE_AUDIO_TYPE ?? 'audio/wav', filename: 'smoke.wav', language: 'zh' });
  console.log(`asr ok: ${transcript.text || '<empty>'}`);
} else {
  console.log('asr skipped: set MEDIA_SMOKE_AUDIO_BASE64 to test transcription');
}

const generatedImage = await image.generate({ prompt: 'a clean mathematical classroom diagram of a parabola', width: 1024, height: 576 });
console.log(`image ok: ${generatedImage.kind === 'remote' ? generatedImage.url : `${generatedImage.bytes.byteLength} bytes`}`);

if (process.env.MEDIA_SMOKE_VIDEO === 'true') {
  const task = await video.submit({ prompt: 'a clean educational animation of a parabola being drawn', durationSeconds: 5, aspectRatio: '16:9', resolution: '720p' });
  console.log(`video submitted: ${task.providerTaskId}`);
} else {
  console.log('video submit skipped: set MEDIA_SMOKE_VIDEO=true because video generation is billable');
}
