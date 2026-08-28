import type {
  Api,
  AuthContext,
  CredentialStore,
  Model,
  ModelThinkingLevel,
  Models,
  MutableModels,
} from '@earendil-works/pi-ai';
import { createProvider, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

export type ModelRef = {
  providerId: string;
  modelId: string;
};

export const MODEL_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ModelThinkingLevel[];

export const EXCLUDED_MODEL_PROVIDER_IDS = [
  'amazon-bedrock',
  'baseten',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'fireworks',
  'github-copilot',
  'huggingface',
] as const;

export function parseModelThinkingLevel(value: unknown): ModelThinkingLevel {
  if (
    typeof value === 'string' &&
    (MODEL_THINKING_LEVELS as readonly string[]).includes(value)
  ) {
    return value as ModelThinkingLevel;
  }
  throw new Error(`Invalid model thinking level: ${String(value)}`);
}

export type ModelSelection = ModelRef & {
  thinkingLevel: ModelThinkingLevel;
};

export type ProviderSummary = {
  id: string;
  name: string;
  configured: boolean;
  modelCount: number;
};

export type ModelSummary = {
  id: string;
  name: string;
  providerId: string;
  reasoning: boolean;
  thinkingLevels: readonly ModelThinkingLevel[];
  input: readonly string[];
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export class UnsupportedThinkingLevelError extends Error {
  constructor(
    readonly selection: ModelSelection,
    readonly supportedLevels: readonly ModelThinkingLevel[],
  ) {
    super(
      `Thinking level ${selection.thinkingLevel} is not supported by ${selection.providerId}/${selection.modelId}`,
    );
    this.name = 'UnsupportedThinkingLevelError';
  }
}

export type CustomOpenAiProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: readonly CustomOpenAiModel[];
};

export type CustomOpenAiModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: readonly ('text' | 'image')[];
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type CreateModelCatalogOptions = {
  credentials?: CredentialStore;
  authContext?: AuthContext;
  customProviders?: readonly CustomOpenAiProvider[];
};

function registerCustomProviders(
  models: MutableModels,
  providers: readonly CustomOpenAiProvider[],
) {
  for (const provider of providers) {
    const providerModels = provider.models.map(
      (model) =>
        ({
          id: model.id,
          name: model.name,
          api: 'openai-completions',
          provider: provider.id,
          baseUrl: provider.baseUrl,
          reasoning: model.reasoning,
          input: [...model.input],
          cost: model.cost,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          ...(model.reasoning ? { compat: { supportsReasoningEffort: true } } : {}),
        }) satisfies Model<'openai-completions'>,
    );

    models.setProvider(
      createProvider({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        auth: {
          apiKey: {
            name: `${provider.name} API key`,
            resolve: async () =>
              provider.apiKey
                ? { auth: { apiKey: provider.apiKey } }
                : undefined,
          },
        },
        models: providerModels,
        api: openAICompletionsApi(),
      }),
    );
  }
}

export class ModelCatalog {
  constructor(private readonly models: Models) {}

  async listProviders(): Promise<ProviderSummary[]> {
    return Promise.all(
      this.models.getProviders().map(async (provider) => {
        try {
          const auth = await this.models.checkAuth(provider.id);
          return {
            id: provider.id,
            name: provider.name,
            configured: auth !== undefined,
            modelCount: provider.getModels().length,
          };
        } catch {
          return {
            id: provider.id,
            name: provider.name,
            configured: false,
            modelCount: provider.getModels().length,
          };
        }
      }),
    );
  }

  listModels(providerId: string): ModelSummary[] {
    return this.models.getModels(providerId).map((model) => ({
      id: model.id,
      name: model.name,
      providerId: model.provider,
      reasoning: model.reasoning,
      thinkingLevels: getSupportedThinkingLevels(model),
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: model.cost,
    }));
  }

  async getAvailableModels(): Promise<ModelSummary[]> {
    const available = await this.models.getAvailable();
    return available.map((model) => ({
      id: model.id,
      name: model.name,
      providerId: model.provider,
      reasoning: model.reasoning,
      thinkingLevels: getSupportedThinkingLevels(model),
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: model.cost,
    }));
  }

  async refresh(providerIds?: readonly string[]) {
    const result = await this.models.refresh({
      ...(providerIds ? { providers: providerIds } : {}),
    });

    return {
      aborted: result.aborted,
      errors: Array.from(result.errors, ([providerId, error]) => ({
        providerId,
        message: error.message,
      })),
    };
  }

  async resolveModel(ref: ModelRef): Promise<Model<Api>> {
    const model = this.models.getModel(ref.providerId, ref.modelId);
    if (!model) {
      throw new Error(`Model ${ref.providerId}/${ref.modelId} is not available`);
    }

    const auth = await this.models.getAuth(model);
    if (!auth) {
      throw new Error(`Provider ${ref.providerId} is not configured`);
    }

    return model;
  }

  async resolveSelection(selection: ModelSelection) {
    const model = await this.resolveModel(selection);
    const supportedLevels = getSupportedThinkingLevels(model);
    if (!supportedLevels.includes(selection.thinkingLevel)) {
      throw new UnsupportedThinkingLevelError(selection, supportedLevels);
    }
    return {
      models: this.models,
      model,
      thinkingLevel: selection.thinkingLevel,
    };
  }

  async completeSimple(
    ref: ModelRef,
    context: Parameters<Models['completeSimple']>[1],
    options?: Parameters<Models['completeSimple']>[2],
  ) {
    const model = await this.resolveModel(ref);
    return this.models.completeSimple(model, context, options);
  }

  async streamSimple(
    ref: ModelRef,
    context: Parameters<Models['streamSimple']>[1],
    options?: Parameters<Models['streamSimple']>[2],
  ) {
    const model = await this.resolveModel(ref);
    return this.models.streamSimple(model, context, options);
  }

  async testConnection(ref: ModelRef) {
    const startedAt = Date.now();
    const response = await this.completeSimple(
      ref,
      {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Reply with OK.' }],
            timestamp: Date.now(),
          },
        ],
      },
      { maxTokens: 8, maxRetries: 0, timeoutMs: 15_000 },
    );
    return {
      providerId: ref.providerId,
      modelId: ref.modelId,
      durationMs: Date.now() - startedAt,
      usage: response.usage,
    };
  }
}

export function createModelCatalog(
  options: CreateModelCatalogOptions = {},
): ModelCatalog {
  const models = builtinModels({
    ...(options.credentials ? { credentials: options.credentials } : {}),
    ...(options.authContext ? { authContext: options.authContext } : {}),
  });
  for (const providerId of EXCLUDED_MODEL_PROVIDER_IDS) {
    models.deleteProvider(providerId);
  }
  registerCustomProviders(models, options.customProviders ?? []);
  return new ModelCatalog(models);
}

export function createModelCatalogFromModels(models: Models): ModelCatalog {
  return new ModelCatalog(models);
}
