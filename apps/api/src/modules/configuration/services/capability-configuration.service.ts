import type { Database } from '../../../db/client';
import { createAgentSettingsDal, createProviderCredentialsDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import { IMAGE_PROVIDERS } from '../../../providers/image/providers';
import { VIDEO_PROVIDERS } from '../../../providers/video/providers';
import type { ImageProviderId } from '../../../providers/image/types';
import type { VideoProviderId } from '../../../providers/video/types';
import { resolveMediaEnvironment } from '../../../providers/media-environment';
import type { CapabilitySettingsInput } from '../schemas';

const DEFAULT_SPEECH = {
  adapter: 'browser' as const,
  language: 'zh-CN',
  voiceUri: null,
  rate: 0.95,
  volume: 1,
};

export class CapabilityConfigurationService {
  private readonly settings;
  private readonly credentials;

  constructor(db: Database, private readonly environment: NodeJS.ProcessEnv = process.env) {
    this.settings = createAgentSettingsDal(db);
    this.credentials = createProviderCredentialsDal(db);
  }

  async get(userId: string) {
    return projectCapabilities(await this.settings.get(userId));
  }

  async update(userId: string, input: CapabilitySettingsInput) {
    if (input.image) await this.validateMediaSelection(userId, 'image', input.image);
    if (input.video) {
      await this.validateMediaSelection(userId, 'video', input.video);
      const provider = VIDEO_PROVIDERS[input.video.providerId as VideoProviderId]!;
      if (!provider.durations.includes(input.video.durationSeconds)) {
        throw new ApiError(400, 'The selected video duration is not supported', 'MEDIA_OPTION_UNSUPPORTED');
      }
      if (!provider.resolutions.includes(input.video.resolution)) {
        throw new ApiError(400, 'The selected video resolution is not supported', 'MEDIA_OPTION_UNSUPPORTED');
      }
    }
    const row = await this.settings.setCapabilities(userId, input);
    return projectCapabilities(row);
  }

  private async validateMediaSelection(
    userId: string,
    capability: 'image' | 'video',
    selection: { providerId: string; modelId: string | null },
  ) {
    const provider = capability === 'image'
      ? IMAGE_PROVIDERS[selection.providerId as ImageProviderId]
      : VIDEO_PROVIDERS[selection.providerId as VideoProviderId];
    if (!provider) {
      throw new ApiError(400, 'The selected media provider is not supported', 'MEDIA_PROVIDER_UNSUPPORTED');
    }
    const credential = await this.credentials.getByProvider(userId, `media:${capability}:${selection.providerId}`);
    const environment = resolveMediaEnvironment(capability, selection.providerId, this.environment);
    if (provider.requiresApiKey && !credential?.apiKeyEnc && !environment.apiKey) {
      throw new ApiError(409, 'The selected media provider is not configured', 'MEDIA_PROVIDER_NOT_CONFIGURED');
    }
    if (provider.models.length > 0) {
      if (!selection.modelId || !provider.models.some((model) => model.id === selection.modelId)) {
        throw new ApiError(400, 'The selected media model is not supported', 'MEDIA_MODEL_UNSUPPORTED');
      }
    } else if (selection.modelId) {
      throw new ApiError(400, 'This media provider does not use a catalog model', 'MEDIA_MODEL_UNSUPPORTED');
    }
    return provider;
  }
}

function projectCapabilities(row: Awaited<ReturnType<ReturnType<typeof createAgentSettingsDal>['get']>>) {
  if (!row) return { image: null, video: null, speech: DEFAULT_SPEECH };
  return {
    image: row.defaultImageProviderId
      ? { providerId: row.defaultImageProviderId, modelId: row.defaultImageModelId }
      : null,
    video: row.defaultVideoProviderId
      ? {
          providerId: row.defaultVideoProviderId,
          modelId: row.defaultVideoModelId,
          durationSeconds: row.defaultVideoDurationSeconds,
          resolution: row.defaultVideoResolution as '720p' | '1080p',
        }
      : null,
    speech: {
      adapter: 'browser' as const,
      language: row.speechLanguage,
      voiceUri: row.speechVoiceUri,
      rate: row.speechRate,
      volume: row.speechVolume,
    },
  };
}
