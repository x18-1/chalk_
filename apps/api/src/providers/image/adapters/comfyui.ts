import { mapHttpError, ProviderError } from '../../provider-error';
import type { ImageAdapter, ImageInput, ImageOutput } from '../types';

type ComfyOptions = {
  apiKey?: string;
  baseUrl: string;
  workflowJson?: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

type HistoryEntry = {
  outputs?: Record<string, { images?: Array<{ filename?: unknown; subfolder?: unknown; type?: unknown }> }>;
  status?: { completed?: boolean; status_str?: string; messages?: Array<[string, Record<string, unknown>]> };
};

export class ComfyUiImageAdapter implements ImageAdapter {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: ComfyOptions) {
    if (!options.baseUrl.trim()) throw new Error('ComfyUI requires a base URL');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async generate(input: ImageInput): Promise<ImageOutput> {
    const workflow = structuredClone(input.workflowJson ?? this.options.workflowJson ?? {});
    if (!Object.keys(workflow).length) throw new ProviderError('INVALID_REQUEST', 'ComfyUI requires a workflow JSON', false);
    patchWorkflow(workflow, input);
    const base = this.baseUrl();
    const queued = await this.requestJson<{ prompt_id?: unknown }>(`${base}/prompt`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ prompt: workflow, client_id: `chalk-${Date.now()}` }),
    });
    if (typeof queued.prompt_id !== 'string' || !queued.prompt_id) throw new ProviderError('MALFORMED_RESPONSE', 'ComfyUI returned no prompt id', true);

    const deadline = Date.now() + (this.options.timeoutMs ?? 300_000);
    let entry: HistoryEntry | null = null;
    while (Date.now() < deadline) {
      const history = await this.requestJson<Record<string, HistoryEntry>>(`${base}/history/${encodeURIComponent(queued.prompt_id)}`, { headers: this.headers() }, true);
      entry = history[queued.prompt_id] ?? null;
      if (entry?.status?.status_str === 'error') throw new ProviderError('UPSTREAM_FAILED', executionError(entry), false);
      if (entry?.status?.completed) break;
      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs ?? 1_500));
    }
    if (!entry?.status?.completed) throw new ProviderError('UPSTREAM_TIMEOUT', 'ComfyUI generation timed out', true);
    const image = firstImage(entry);
    if (!image) throw new ProviderError('MALFORMED_RESPONSE', 'ComfyUI returned no output image', true);
    const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
    const response = await this.fetcher(`${base}/view?${params}`, { headers: this.headers(), signal: this.signal() });
    if (!response.ok) throw mapHttpError(response.status, 'ComfyUI image');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new ProviderError('MALFORMED_RESPONSE', 'ComfyUI returned empty image', true);
    return { kind: 'bytes', bytes, contentType: response.headers.get('content-type')?.split(';')[0] ?? 'image/png' };
  }

  async testConnection() {
    const response = await this.fetcher(`${this.baseUrl()}/system_stats`, { headers: this.headers(), signal: this.signal() });
    if (!response.ok) throw mapHttpError(response.status, 'ComfyUI');
  }

  private baseUrl() { return this.options.baseUrl.replace(/\/$/, ''); }
  private headers(): Record<string, string> { return this.options.apiKey?.trim() ? { authorization: `Bearer ${this.options.apiKey}` } : {}; }
  private signal() { return AbortSignal.timeout(this.options.timeoutMs ?? 30_000); }
  private async requestJson<T>(url: string, init: RequestInit, tolerateFailure = false): Promise<T> {
    try {
      const response = await this.fetcher(url, { ...init, signal: init.signal ?? this.signal() });
      if (!response.ok) { if (tolerateFailure) return {} as T; throw mapHttpError(response.status, 'ComfyUI'); }
      return await response.json() as T;
    } catch (error) {
      if (tolerateFailure) return {} as T;
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('UPSTREAM_TIMEOUT', 'ComfyUI request failed', true);
    }
  }
}

function patchWorkflow(workflow: Record<string, unknown>, input: ImageInput) {
  const prompt = findNode(workflow, ['Input Prompt', 'String (Multiline - Prompt)']);
  if (!prompt) throw new ProviderError('INVALID_REQUEST', 'ComfyUI workflow is missing an Input Prompt node', false);
  const promptInputs = nodeInputs(prompt.node);
  if (!promptInputs) throw new ProviderError('INVALID_REQUEST', 'ComfyUI prompt node is malformed', false);
  promptInputs.value = input.prompt;
  const width = input.width ?? (input.aspectRatio === '16:9' ? 1024 : undefined);
  const height = input.height ?? (input.aspectRatio === '16:9' ? 576 : undefined);
  const widthNode = findNode(workflow, ['Width']);
  const heightNode = findNode(workflow, ['Height']);
  if (width && height && widthNode && heightNode) {
    const widthInputs = nodeInputs(widthNode.node);
    const heightInputs = nodeInputs(heightNode.node);
    if (widthInputs) widthInputs.value = width;
    if (heightInputs) heightInputs.value = height;
  } else {
    const latent = findNode(workflow, ['Empty Flux 2 Latent']);
    const latentInputs = latent && nodeInputs(latent.node);
    if (latentInputs && width && height) { latentInputs.width = width; latentInputs.height = height; }
  }
  const sampler = findNode(workflow, ['KSampler']);
  const samplerInputs = sampler && nodeInputs(sampler.node);
  if (samplerInputs) samplerInputs.seed = Math.floor(Math.random() * 1_000_000_000_000);
}

function findNode(workflow: Record<string, unknown>, titles: string[]) {
  const wanted = new Set(titles.map((title) => title.toLowerCase()));
  for (const [id, value] of Object.entries(workflow)) {
    const title = ((value as Record<string, unknown>)?._meta as Record<string, unknown> | undefined)?.title;
    if (typeof title === 'string' && wanted.has(title.toLowerCase())) return { id, node: value };
  }
  return undefined;
}
function nodeInputs(node: unknown) { const inputs = (node as Record<string, unknown> | undefined)?.inputs; return inputs && typeof inputs === 'object' ? inputs as Record<string, unknown> : undefined; }
function firstImage(entry: HistoryEntry) {
  for (const output of Object.values(entry.outputs ?? {})) {
    const image = output.images?.[0];
    if (typeof image?.filename === 'string') return { filename: image.filename, subfolder: typeof image.subfolder === 'string' ? image.subfolder : '', type: typeof image.type === 'string' ? image.type : 'output' };
  }
  return undefined;
}
function executionError(entry: HistoryEntry) {
  const message = entry.status?.messages?.find(([event]) => event === 'execution_error')?.[1];
  return typeof message?.exception_message === 'string' ? `ComfyUI execution failed: ${message.exception_message}` : 'ComfyUI workflow execution failed';
}
