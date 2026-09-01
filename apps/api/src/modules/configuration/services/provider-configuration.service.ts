import {
  closeUserRuntimes,
  createUserModelCatalog,
} from '../../../agent/runtime-manager';
import type { Database } from '../../../db/client';
import {
  createAgentSettingsDal,
  createCustomProvidersDal,
  createProviderCredentialsDal,
} from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import { DrizzleCredentialStore } from '../../../providers/llm/credential-store';
import {
  parseModelThinkingLevel,
  UnsupportedThinkingLevelError,
  type ModelSelection,
} from '../../../providers/llm/model-catalog';
import { encrypt } from '../../../security/credential-encryption';
import {
  customProviderModelSchema,
  type CustomProviderInput,
  type CustomProviderUpdateInput,
  type RagSettingsInput,
} from '../schemas';

type StoredSettings = {
  defaultProviderId: string | null;
  defaultModelId: string | null;
  defaultThinkingLevel: string;
  memoryInjectionEnabled: boolean;
} | null;

function defaultModel(settings: StoredSettings) {
  return settings?.defaultProviderId && settings.defaultModelId
    ? {
        providerId: settings.defaultProviderId,
        modelId: settings.defaultModelId,
        thinkingLevel: parseModelThinkingLevel(settings.defaultThinkingLevel),
      }
    : null;
}

function parseStoredCustomModels(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((model) => {
    if (typeof model === 'string') {
      return [{
        id: model,
        name: model,
        reasoning: false,
        input: ['text', 'image'] as ('text' | 'image')[],
        contextWindow: 128_000,
        maxTokens: 8_192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }];
    }
    const parsed = customProviderModelSchema.safeParse(model);
    return parsed.success ? [parsed.data] : [];
  });
}

function publicCustomProvider(row: {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  modelIds: unknown;
  enabled: boolean;
  apiKeyEnc: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    api: row.api,
    models: parseStoredCustomModels(row.modelIds),
    enabled: row.enabled,
    configured: Boolean(row.apiKeyEnc),
    canRemoveCredential: Boolean(row.apiKeyEnc),
  };
}

export class ProviderConfigurationService {
  private readonly settings;
  private readonly customProviders;
  private readonly providerCredentials;

  constructor(private readonly db: Database) {
    this.settings = createAgentSettingsDal(db);
    this.customProviders = createCustomProvidersDal(db);
    this.providerCredentials = createProviderCredentialsDal(db);
  }

  async listProviders(userId: string) {
    const catalog = await createUserModelCatalog(userId);
    const [providers, custom, storedCredentials, settings] = await Promise.all([
      catalog.listProviders(),
      this.customProviders.list(userId),
      this.providerCredentials.list(userId),
      this.settings.get(userId),
    ]);
    const storedCredentialProviderIds = new Set(
      storedCredentials.map((row) => row.providerId),
    );
    const customById = new Map(custom.map((row) => {
      const provider = publicCustomProvider(row);
      return [provider.id, provider] as const;
    }));
    const unifiedProviders = providers.map((provider) => {
      const customProvider = customById.get(provider.id);
      if (!customProvider) {
        return {
          ...provider,
          custom: false as const,
          canRemoveCredential: storedCredentialProviderIds.has(provider.id),
        };
      }
      customById.delete(provider.id);
      return { ...provider, ...customProvider, custom: true as const };
    });
    for (const provider of customById.values()) {
      unifiedProviders.push({
        ...provider,
        custom: true,
        modelCount: provider.models.length,
      });
    }
    return { providers: unifiedProviders, defaultModel: defaultModel(settings) };
  }

  async saveCredential(userId: string, providerId: string, apiKey: string) {
    const catalog = await createUserModelCatalog(userId);
    const providers = await catalog.listProviders();
    if (!providers.some((provider) => provider.id === providerId)) {
      throw new ApiError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
    }
    await new DrizzleCredentialStore(this.db, userId).modify(
      providerId,
      async () => ({ type: 'api_key', key: apiKey }),
    );
    await closeUserRuntimes(userId);
    return { providerId, configured: true };
  }

  async removeCredential(userId: string, providerId: string) {
    await new DrizzleCredentialStore(this.db, userId).delete(providerId);
    await closeUserRuntimes(userId);
    const provider = (await createUserModelCatalog(userId).then((catalog) =>
      catalog.listProviders()))
      .find((item) => item.id === providerId);
    return {
      providerId,
      configured: provider?.configured ?? false,
      canRemoveCredential: false,
    };
  }

  async testProvider(userId: string, providerId: string, modelId: string) {
    try {
      return {
        ok: true as const,
        ...(await createUserModelCatalog(userId).then((catalog) =>
          catalog.testConnection({ providerId, modelId }))),
      };
    } catch (error) {
      return {
        ok: false as const,
        providerId,
        modelId,
        error: error instanceof Error ? error.message : 'Provider connection failed',
      };
    }
  }

  async listCustomProviders(userId: string) {
    return {
      providers: (await this.customProviders.list(userId)).map(publicCustomProvider),
    };
  }

  async createCustomProvider(userId: string, input: CustomProviderInput) {
    const row = await this.customProviders.create(userId, {
      name: input.name,
      baseUrl: input.baseUrl,
      api: input.api,
      modelIds: input.models,
      enabled: input.enabled,
      ...(input.apiKey ? { apiKeyEnc: encrypt(input.apiKey) } : {}),
    });
    await closeUserRuntimes(userId);
    return publicCustomProvider(row);
  }

  async updateCustomProvider(
    userId: string,
    providerId: string,
    input: CustomProviderUpdateInput,
  ) {
    const { apiKey, models, ...data } = input;
    const row = await this.customProviders.update(userId, providerId, {
      ...data,
      ...(models !== undefined ? { modelIds: models } : {}),
      ...(apiKey !== undefined
        ? { apiKeyEnc: apiKey ? encrypt(apiKey) : null }
        : {}),
    });
    await closeUserRuntimes(userId);
    return publicCustomProvider(row);
  }

  async deleteCustomProvider(userId: string, providerId: string) {
    await this.customProviders.delete(userId, providerId);
    await closeUserRuntimes(userId);
  }

  async listModels(userId: string, providerId?: string) {
    const catalog = await createUserModelCatalog(userId);
    return {
      models: providerId
        ? catalog.listModels(providerId)
        : await catalog.getAvailableModels(),
    };
  }

  async refreshModels(userId: string, providerId?: string) {
    const catalog = await createUserModelCatalog(userId);
    return catalog.refresh(providerId ? [providerId] : undefined);
  }

  async getSettings(userId: string) {
    const settings = await this.settings.get(userId);
    return {
      defaultModel: defaultModel(settings),
      memoryInjectionEnabled: settings?.memoryInjectionEnabled ?? true,
    };
  }

  async setMemoryInjectionEnabled(userId: string, enabled: boolean) {
    const settings = await this.settings.setMemoryInjectionEnabled(userId, enabled);
    await closeUserRuntimes(userId);
    return { memoryInjectionEnabled: settings.memoryInjectionEnabled };
  }

  async getRagSettings(userId: string) {
    if (!userId) throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
    const env = process.env;
    const rows = await this.providerCredentials.list(userId);
    const row = (id: string) => rows.find((item) => item.providerId === id);
    const settings = (id: string) => {
      const value = row(id)?.settings;
      return value && typeof value === 'object' ? value as Record<string, unknown> : {};
    };
    const embedding = settings('rag:embedding');
    const rerank = settings('rag:rerank');
    const pdf = settings('rag:pdf');
    return {
      embedding: {
        model: typeof embedding.model === 'string' ? embedding.model : env.RAG_EMBEDDING_MODEL || 'text-embedding-3-small',
        baseUrl: typeof embedding.baseUrl === 'string' ? embedding.baseUrl : env.RAG_EMBEDDING_BASE_URL || env.OPENAI_BASE_URL || '',
        configured: Boolean(row('rag:embedding')?.apiKeyEnc || env.RAG_EMBEDDING_API_KEY || env.OPENAI_API_KEY),
      },
      rerank: {
        model: typeof rerank.model === 'string' ? rerank.model : env.RAG_RERANK_MODEL || '',
        url: typeof rerank.url === 'string' ? rerank.url : env.RAG_RERANK_URL || '',
        configured: Boolean(
          (typeof rerank.url === 'string' ? rerank.url : env.RAG_RERANK_URL)
          && (typeof rerank.model === 'string' ? rerank.model : env.RAG_RERANK_MODEL)
          && (row('rag:rerank')?.apiKeyEnc || env.RAG_RERANK_API_KEY || env.RAG_LLM_API_KEY),
        ),
      },
      pdf: {
        engine: typeof pdf.engine === 'string' ? pdf.engine : env.RAG_PARSER_ENGINE || 'text_only',
        mode: typeof pdf.mode === 'string' ? pdf.mode : env.RAG_MINERU_MODE || 'local',
        modelVersion: typeof pdf.modelVersion === 'string' ? pdf.modelVersion : env.RAG_MINERU_MODEL_VERSION || 'pipeline',
        ocr: typeof pdf.ocr === 'boolean' ? pdf.ocr : (env.RAG_MINERU_OCR || 'false').toLowerCase() === 'true',
        formula: typeof pdf.formula === 'boolean' ? pdf.formula : (env.RAG_MINERU_ENABLE_FORMULA || 'true').toLowerCase() !== 'false',
        table: typeof pdf.table === 'boolean' ? pdf.table : (env.RAG_MINERU_ENABLE_TABLE || 'true').toLowerCase() !== 'false',
        language: typeof pdf.language === 'string' ? pdf.language : env.RAG_MINERU_LANGUAGE || 'auto',
      },
    };
  }

  async updateRagSettings(userId: string, input: RagSettingsInput) {
    if (!userId) throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
    // Persist non-secret fields and encrypt credentials using the same store
    // as the model and media Provider settings. Environment values remain the
    // deployment defaults and are updated for the current process.
    if (input.embedding) {
      process.env.RAG_EMBEDDING_MODEL = input.embedding.model;
      process.env.RAG_EMBEDDING_BASE_URL = input.embedding.baseUrl ?? '';
      if (input.embedding.apiKey) process.env.RAG_EMBEDDING_API_KEY = input.embedding.apiKey;
      const existing = await this.providerCredentials.getByProvider(userId, 'rag:embedding');
      await this.providerCredentials.upsert(userId, 'rag:embedding', input.embedding.apiKey ? encrypt(input.embedding.apiKey) : existing?.apiKeyEnc ?? null, input.embedding.baseUrl ?? null, { model: input.embedding.model, baseUrl: input.embedding.baseUrl ?? '' });
    }
    if (input.rerank) {
      process.env.RAG_RERANK_MODEL = input.rerank.model;
      process.env.RAG_RERANK_URL = input.rerank.url ?? '';
      if (input.rerank.apiKey) process.env.RAG_RERANK_API_KEY = input.rerank.apiKey;
      const existing = await this.providerCredentials.getByProvider(userId, 'rag:rerank');
      await this.providerCredentials.upsert(userId, 'rag:rerank', input.rerank.apiKey ? encrypt(input.rerank.apiKey) : existing?.apiKeyEnc ?? null, input.rerank.url ?? null, { model: input.rerank.model, url: input.rerank.url ?? '' });
    }
    if (input.pdf) {
      process.env.RAG_PARSER_ENGINE = input.pdf.engine;
      process.env.RAG_MINERU_MODE = input.pdf.mode;
      process.env.RAG_MINERU_MODEL_VERSION = input.pdf.modelVersion;
      process.env.RAG_MINERU_OCR = String(input.pdf.ocr);
      process.env.RAG_MINERU_ENABLE_FORMULA = String(input.pdf.formula);
      process.env.RAG_MINERU_ENABLE_TABLE = String(input.pdf.table);
      process.env.RAG_MINERU_LANGUAGE = input.pdf.language;
      if (input.pdf.apiToken) process.env.RAG_MINERU_API_TOKEN = input.pdf.apiToken;
      const existing = await this.providerCredentials.getByProvider(userId, 'rag:pdf');
      const { apiToken, ...pdfSettings } = input.pdf;
      await this.providerCredentials.upsert(userId, 'rag:pdf', apiToken ? encrypt(apiToken) : existing?.apiKeyEnc ?? null, null, pdfSettings);
    }
    await fetch(`${(process.env.RAG_SIDECAR_URL || 'http://127.0.0.1:8010').replace(/\/$/, '')}/v1/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.RAG_SIDECAR_TOKEN || ''}` },
      body: JSON.stringify(input),
    }).catch(() => undefined);
    return this.getRagSettings(userId);
  }

  async setDefaultModel(userId: string, model: ModelSelection) {
    try {
      await createUserModelCatalog(userId).then((catalog) =>
        catalog.resolveSelection(model));
    } catch (error) {
      if (error instanceof UnsupportedThinkingLevelError) {
        throw new ApiError(400, error.message, 'UNSUPPORTED_THINKING_LEVEL');
      }
      throw error;
    }
    const settings = await this.settings.setDefaultModel(userId, model);
    await closeUserRuntimes(userId);
    return { defaultModel: defaultModel(settings) };
  }
}
