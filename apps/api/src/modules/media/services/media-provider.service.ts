import type { Database } from '../../../db/client';
import { createProviderCredentialsDal } from '../../../db/dal';
import { decrypt } from '../../../security/credential-encryption';
import { ProviderError } from '../../../providers/provider-error';
import { ASR_PROVIDERS, createAsrAdapter } from '../../../providers/asr/providers';
import { IMAGE_PROVIDERS, createImageAdapter } from '../../../providers/image/providers';
import { TTS_PROVIDERS, createTtsAdapter } from '../../../providers/tts/providers';
import { VIDEO_PROVIDERS, createVideoAdapter } from '../../../providers/video/providers';
import type { AsrProviderId } from '../../../providers/asr/types';
import type { ImageProviderId } from '../../../providers/image/types';
import type { TtsProviderId } from '../../../providers/tts/types';
import type { VideoProviderId } from '../../../providers/video/types';
import { resolveMediaEnvironment, type MediaCapability } from '../../../providers/media-environment';
import type { AsrRequest, ImageRequest, TtsRequest, VideoSubmitRequest } from '../schemas';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

export class MediaProviderService {
  private readonly credentials;
  constructor(private readonly db: Database, private readonly environment: NodeJS.ProcessEnv = process.env) {
    this.credentials = createProviderCredentialsDal(db);
  }

  async listProviders(userId: string) {
    const rows = await this.credentials.list(userId);
    return {
      tts: Object.values(TTS_PROVIDERS).map((provider) => publicProvider('tts', provider, rows, this.environment)),
      asr: Object.values(ASR_PROVIDERS).map((provider) => publicProvider('asr', provider, rows, this.environment)),
      image: Object.values(IMAGE_PROVIDERS).map((provider) => publicProvider('image', provider, rows, this.environment)),
      video: Object.values(VIDEO_PROVIDERS).map((provider) => publicProvider('video', provider, rows, this.environment)),
    };
  }

  async saveCredential(userId: string, capability: MediaCapability, providerId: string, input: { apiKey?: string; baseUrl?: string; settings?: { backend?: string; workflowId?: string; modelId?: string } }) {
    if (!isKnownProvider(capability, providerId)) throw new ProviderError('UNSUPPORTED', 'Unsupported media provider', false);
    const provider = providerConfig(capability, providerId);
    const existing = await this.credentials.getByProvider(userId, credentialId(capability, providerId));
    const environment = resolveMediaEnvironment(capability, providerId, this.environment);
    if (provider.requiresApiKey && !input.apiKey?.trim() && !existing?.apiKeyEnc && !environment.apiKey) throw new ProviderError('INVALID_REQUEST', `${capability}/${providerId} requires an API key`, false);
    if (input.settings?.modelId && provider.models.length > 0 && !provider.models.some((model) => model.id === input.settings?.modelId)) throw new ProviderError('INVALID_REQUEST', `Unknown model for ${capability}/${providerId}`, false);
    const baseUrl = input.baseUrl?.trim() || existing?.baseUrl || environment.baseUrl || provider.defaultBaseUrl;
    validateBaseUrl(baseUrl);
    const { encrypt } = await import('../../../security/credential-encryption');
    const apiKeyEnc = input.apiKey?.trim() ? encrypt(input.apiKey.trim()) : existing?.apiKeyEnc ?? null;
    await this.credentials.upsert(userId, credentialId(capability, providerId), apiKeyEnc, baseUrl, input.settings ?? existing?.settings ?? null);
    return { capability, providerId, configured: true, baseUrl, credentialSource: apiKeyEnc ? 'user' as const : environment.apiKey || environment.baseUrl ? 'environment' as const : 'user' as const, canRemoveCredential: true };
  }

  async removeCredential(userId: string, capability: MediaCapability, providerId: string) {
    if (capability === 'image' || capability === 'video') {
      await this.credentials.deleteMediaAndClearDefault(userId, capability, providerId);
    } else {
      await this.credentials.delete(userId, credentialId(capability, providerId));
    }
    const environment = resolveMediaEnvironment(capability, providerId, this.environment);
    return { capability, providerId, configured: Boolean(environment.apiKey || environment.baseUrl), credentialSource: environment.apiKey || environment.baseUrl ? 'environment' as const : 'none' as const, canRemoveCredential: false };
  }

  async synthesize(userId: string, input: TtsRequest) {
    const result = await this.synthesizeBinary(userId, input);
    return { audioBase64: result.bytes.toString('base64'), format: result.format, contentType: result.contentType };
  }

  async synthesizeBinary(userId: string, input: TtsRequest & { signal?: AbortSignal }) {
    const config = await this.providerConfigForUser(userId, 'tts', input.providerId);
    const adapter = createTtsAdapter({ providerId: input.providerId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl });
    const model = requestedModel(providerConfig('tts', input.providerId), input.model, config.settings);
    const result = await adapter.synthesize({ ...input, model, providerOptions: input.providerOptions ?? (config.settings as TtsRequest['providerOptions']) });
    return {
      bytes: Buffer.from(result.bytes),
      format: result.format,
      contentType: result.contentType,
      providerId: input.providerId,
      modelId: model ?? 'provider-default',
    };
  }

  async transcribe(userId: string, input: AsrRequest) {
    const config = await this.providerConfigForUser(userId, 'asr', input.providerId);
    const adapter = createAsrAdapter({ providerId: input.providerId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl });
    const model = requestedModel(providerConfig('asr', input.providerId), input.model, config.settings);
    return adapter.transcribe({ bytes: Uint8Array.from(Buffer.from(input.audioBase64, 'base64')), contentType: input.contentType, filename: input.filename, model, language: input.language });
  }

  async generateImage(userId: string, input: ImageRequest) {
    const config = await this.providerConfigForUser(userId, 'image', input.providerId);
    const provider = IMAGE_PROVIDERS[input.providerId];
    if (input.aspectRatio && !provider.aspectRatios.includes(input.aspectRatio)) throw new ProviderError('INVALID_REQUEST', `Unsupported image aspect ratio: ${input.aspectRatio}`, false);
    const workflowJson = input.providerId === 'comfyui' ? input.workflowJson ?? await this.workflow(input.model ?? (config.settings?.workflowId as string | undefined)) : undefined;
    const adapter = createImageAdapter({ providerId: input.providerId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl, workflowJson });
    const model = input.providerId === 'comfyui' ? input.model : requestedModel(providerConfig('image', input.providerId), input.model, config.settings);
    const result = await adapter.generate({ ...input, model });
    return result.kind === 'bytes'
      ? { kind: result.kind, contentType: result.contentType, imageBase64: Buffer.from(result.bytes).toString('base64'), model }
      : { ...result, model };
  }

  async generateImageBinary(userId: string, input: ImageRequest & { signal?: AbortSignal }) {
    const result = await this.generateImage(userId, input);
    const binary = result.kind === 'bytes'
      ? { bytes: Buffer.from(result.imageBase64, 'base64'), contentType: result.contentType }
      : await downloadProviderMedia(result.url, result.contentType, input.signal);
    return {
      ...binary,
      format: imageFormat(binary.contentType),
      providerId: input.providerId,
      modelId: result.model ?? 'provider-default',
    };
  }

  async submitVideo(userId: string, input: VideoSubmitRequest) {
    const config = await this.providerConfigForUser(userId, 'video', input.providerId);
    const adapter = createVideoAdapter({ providerId: input.providerId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl });
    const provider = VIDEO_PROVIDERS[input.providerId];
    validateVideoOptions(provider, input);
    const model = requestedModel(provider, input.model, config.settings);
    return { ...(await adapter.submit({ ...input, model })), model };
  }

  async pollVideo(userId: string, providerId: VideoProviderId, taskId: string, model?: string, signal?: AbortSignal) {
    const config = await this.providerConfigForUser(userId, 'video', providerId);
    const effectiveModel = requestedModel(providerConfig('video', providerId), model, config.settings);
    const result = await createVideoAdapter({ providerId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl }).poll(taskId, signal, effectiveModel);
    return result.status === 'done' && result.bytes ? { ...result, videoBase64: Buffer.from(result.bytes).toString('base64'), bytes: undefined } : result;
  }

  async pollVideoBinary(userId: string, input: { providerTaskId: string; providerId: VideoProviderId; modelId: string; signal?: AbortSignal }) {
    const result = await this.pollVideo(userId, input.providerId, input.providerTaskId, input.modelId, input.signal);
    if (result.status !== 'done') return result;
    const binary = 'videoBase64' in result && typeof result.videoBase64 === 'string'
      ? { bytes: Buffer.from(result.videoBase64, 'base64'), contentType: result.contentType }
      : result.url
        ? await downloadProviderMedia(result.url, result.contentType, input.signal)
        : null;
    if (!binary) throw new ProviderError('MALFORMED_RESPONSE', 'Video provider completed without media', true);
    return { status: 'done' as const, ...binary, format: videoFormat(binary.contentType) };
  }

  async cancelVideo(userId: string, input: { providerTaskId: string; providerId: VideoProviderId; modelId: string; signal?: AbortSignal }) {
    const config = await this.providerConfigForUser(userId, 'video', input.providerId);
    const adapter = createVideoAdapter({ providerId: input.providerId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl });
    await adapter.cancel?.(input.providerTaskId, input.signal);
  }

  async testConnection(userId: string, capability: MediaCapability, providerId: string, model?: string) {
    const config = await this.providerConfigForUser(userId, capability, providerId);
    const selected = requestedModel(providerConfig(capability, providerId), model, config.settings);
    if (capability === 'tts') await createTtsAdapter({ providerId: providerId as TtsProviderId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl }).testConnection(selected);
    if (capability === 'asr') await createAsrAdapter({ providerId: providerId as AsrProviderId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl }).testConnection(selected);
    if (capability === 'image') await createImageAdapter({ providerId: providerId as ImageProviderId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl }).testConnection(selected);
    if (capability === 'video') await createVideoAdapter({ providerId: providerId as VideoProviderId, apiKey: config.apiKey ?? '', baseUrl: config.baseUrl }).testConnection(selected);
    return { ok: true, capability, providerId };
  }

  async listComfyWorkflows() {
    try { return (await readdir(workflowDirectory())).filter(isWorkflowFilename).map((id) => ({ id, name: id.replace(/\.json$/i, '').replace(/^comfyui[-_]?/i, '') })); } catch { return []; }
  }

  private async workflow(workflowId?: string) {
    if (!workflowId) return undefined;
    if (!isWorkflowFilename(workflowId)) throw new ProviderError('INVALID_REQUEST', 'Invalid ComfyUI workflow filename', false);
    try { return JSON.parse(await readFile(join(workflowDirectory(), basename(workflowId)), 'utf8')) as Record<string, unknown>; } catch { throw new ProviderError('INVALID_REQUEST', `ComfyUI workflow not found: ${workflowId}`, false); }
  }

  private async providerConfigForUser(userId: string, capability: MediaCapability, providerId: string) {
    const row = await this.credentials.getByProvider(userId, credentialId(capability, providerId));
    const provider = providerConfig(capability, providerId);
    const environment = resolveMediaEnvironment(capability, providerId, this.environment);
    if (provider.requiresApiKey && !row?.apiKeyEnc && !environment.apiKey) throw new ProviderError('PROVIDER_NOT_CONFIGURED', `${capability}/${providerId} is not configured`, false);
    return { apiKey: row?.apiKeyEnc ? decrypt(row.apiKeyEnc) : environment.apiKey, baseUrl: row?.baseUrl ?? environment.baseUrl ?? provider.defaultBaseUrl, settings: row?.settings && typeof row.settings === 'object' ? row.settings as Record<string, unknown> : {} };
  }
}

function credentialId(capability: MediaCapability, providerId: string) { return `media:${capability}:${providerId}`; }
function selectedModel(settings: Record<string, unknown>) {
  return typeof settings.modelId === 'string' && settings.modelId ? settings.modelId : undefined;
}
function requestedModel(provider: { models: readonly { id: string }[]; defaultModel: string }, requested: string | undefined, settings: Record<string, unknown>) {
  const model = (requested ?? selectedModel(settings) ?? provider.defaultModel) || undefined;
  if (model && provider.models.length > 0 && !provider.models.some((item) => item.id === model)) throw new ProviderError('INVALID_REQUEST', `Unknown model: ${model}`, false);
  return model;
}
function validateVideoOptions(provider: { aspectRatios: readonly string[]; durations: readonly number[]; resolutions: readonly string[] }, input: VideoSubmitRequest) {
  if (input.aspectRatio && !provider.aspectRatios.includes(input.aspectRatio)) throw new ProviderError('INVALID_REQUEST', `Unsupported video aspect ratio: ${input.aspectRatio}`, false);
  if (input.durationSeconds && !provider.durations.includes(input.durationSeconds)) throw new ProviderError('INVALID_REQUEST', `Unsupported video duration: ${input.durationSeconds}`, false);
  if (input.resolution && !provider.resolutions.includes(input.resolution)) throw new ProviderError('INVALID_REQUEST', `Unsupported video resolution: ${input.resolution}`, false);
}
function isKnownProvider(capability: MediaCapability, providerId: string) {
  if (capability === 'tts') return providerId in TTS_PROVIDERS;
  if (capability === 'asr') return providerId in ASR_PROVIDERS;
  if (capability === 'image') return providerId in IMAGE_PROVIDERS;
  return providerId in VIDEO_PROVIDERS;
}
function publicProvider(capability: MediaCapability, provider: { id: string; name: string; defaultBaseUrl: string; models: readonly { id: string; name: string }[]; defaultModel: string; requiresApiKey: boolean; voices?: readonly string[]; formats?: readonly string[]; aspectRatios?: readonly string[]; durations?: readonly number[]; resolutions?: readonly string[] }, rows: Array<{ providerId: string; apiKeyEnc: string | null; baseUrl: string | null; settings: unknown }>, environment: NodeJS.ProcessEnv) {
  const row = rows.find((item) => item.providerId === `media:${capability}:${provider.id}`);
  const deployment = resolveMediaEnvironment(capability, provider.id, environment);
  const userCredential = Boolean(row?.apiKeyEnc || row?.baseUrl);
  const deploymentCredential = Boolean(deployment.apiKey || deployment.baseUrl);
  const configured = provider.requiresApiKey
    ? Boolean(row?.apiKeyEnc || deployment.apiKey)
    : Boolean(row?.baseUrl || deployment.baseUrl);
  return { capability, id: provider.id, name: provider.name, defaultBaseUrl: provider.defaultBaseUrl, models: provider.models, defaultModel: provider.defaultModel, requiresApiKey: provider.requiresApiKey, configured, credentialSource: row?.apiKeyEnc ? 'user' as const : deploymentCredential ? 'environment' as const : userCredential ? 'user' as const : 'none' as const, canRemoveCredential: Boolean(row), baseUrl: row?.baseUrl ?? deployment.baseUrl ?? provider.defaultBaseUrl, settings: row?.settings ?? undefined, ...(provider.voices ? { voices: provider.voices } : {}), ...(provider.formats ? { formats: provider.formats } : {}), ...(provider.aspectRatios ? { aspectRatios: provider.aspectRatios } : {}), ...(provider.durations ? { durations: provider.durations } : {}), ...(provider.resolutions ? { resolutions: provider.resolutions } : {}) };
}

function providerConfig(capability: MediaCapability, providerId: string) {
  const provider = capability === 'tts' ? TTS_PROVIDERS[providerId as TtsProviderId] : capability === 'asr' ? ASR_PROVIDERS[providerId as AsrProviderId] : capability === 'image' ? IMAGE_PROVIDERS[providerId as ImageProviderId] : VIDEO_PROVIDERS[providerId as VideoProviderId];
  if (!provider) throw new ProviderError('UNSUPPORTED', 'Unsupported media provider', false);
  return provider;
}
function validateBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError('INVALID_REQUEST', 'Provider base URL must be a valid URL', false); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ProviderError('INVALID_REQUEST', 'Provider base URL must use HTTP or HTTPS without embedded credentials', false);
  if (process.env.NODE_ENV !== 'production') return;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || isPrivateIpv4(host)) throw new ProviderError('INVALID_REQUEST', 'Private or loopback Provider base URLs are not allowed in production', false);
}
function isPrivateIpv4(host: string) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
function workflowDirectory() { const cwd = process.cwd(); return join(cwd.endsWith('/apps/api') ? cwd : join(cwd, 'apps/api'), 'workflows', 'comfyui'); }
function isWorkflowFilename(value: string) { return /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/i.test(value) && (value.toLowerCase().startsWith('comfyui') || value.toLowerCase().includes('workflow')); }

async function downloadProviderMedia(url: string, declaredContentType: string | undefined, signal: AbortSignal | undefined) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ProviderError('MALFORMED_RESPONSE', 'Generated media URL is invalid', false); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ProviderError('MALFORMED_RESPONSE', 'Generated media URL is not allowed', false);
  }
  if (process.env.NODE_ENV === 'production') {
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || isPrivateIpv4(host)) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Generated media URL targets a private host', false);
    }
  }
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(300_000), redirect: 'follow' });
  if (!response.ok) throw new ProviderError('UPSTREAM_FAILED', `Unable to download generated media (${response.status})`, true);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 32 * 1_024 * 1_024) throw new ProviderError('MALFORMED_RESPONSE', 'Generated media exceeds 32 MiB', false);
  if (!response.body) throw new ProviderError('MALFORMED_RESPONSE', 'Generated media has no response body', true);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > 32 * 1_024 * 1_024) {
      await reader.cancel();
      throw new ProviderError('MALFORMED_RESPONSE', 'Generated media exceeds 32 MiB', false);
    }
    chunks.push(result.value);
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
  if (bytes.byteLength === 0) throw new ProviderError('MALFORMED_RESPONSE', 'Generated media has an invalid size', false);
  return { bytes, contentType: response.headers.get('content-type')?.split(';', 1)[0] || declaredContentType || 'application/octet-stream' };
}

function imageFormat(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  return 'bin';
}

function videoFormat(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized === 'video/mp4') return 'mp4';
  if (normalized === 'video/webm') return 'webm';
  if (normalized === 'video/quicktime') return 'mov';
  return 'bin';
}
