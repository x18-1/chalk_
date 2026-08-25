import { joinUrl, mapHttpError, ProviderError, readJsonObject } from '../../provider-error';
import type { AsrAdapter, AsrInput, AsrOutput } from '../types';

export class QwenAsrAdapter implements AsrAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    if (!options.apiKey.trim()) throw new Error('Qwen ASR requires an API key');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async transcribe(input: AsrInput): Promise<AsrOutput> {
    const response = await this.fetcher(joinUrl(this.options.baseUrl, '/services/aigc/multimodal-generation/generation'), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json; charset=utf-8', 'x-dashscope-audio-format': 'wav' },
      body: JSON.stringify({ model: input.model ?? 'qwen3-asr-flash', input: { messages: [{ role: 'user', content: [{ audio: `data:${input.contentType};base64,${Buffer.from(input.bytes).toString('base64')}` }] }] }, ...(input.language && input.language !== 'auto' ? { parameters: { asr_options: { language: input.language } } } : {}) }),
      signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (/audio is empty|InvalidParameter/i.test(text)) return { text: '' };
      throw mapHttpError(response.status, 'Qwen ASR');
    }
    const data = await readJsonObject(response, 'Qwen ASR');
    const content = (data.output as { choices?: Array<{ message?: { content?: Array<{ text?: unknown }> } }> } | undefined)?.choices?.[0]?.message?.content;
    if (!Array.isArray(content)) return { text: '' };
    const text = content.find((item) => typeof item.text === 'string')?.text;
    if (typeof text !== 'string') throw new ProviderError('MALFORMED_RESPONSE', 'Qwen ASR returned no transcript', true);
    return { text, ...(input.language && input.language !== 'auto' ? { language: input.language } : {}) };
  }

  async testConnection(model?: string) {
    const response = await this.fetcher(joinUrl(this.options.baseUrl, '/services/aigc/multimodal-generation/generation'), { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? 'qwen3-asr-flash', input: { messages: [{ role: 'user', content: [{ audio: 'data:audio/wav;base64,UklGRg==' }] }] } }) });
    if (!response.ok && response.status !== 400) throw mapHttpError(response.status, 'Qwen ASR');
  }
}
