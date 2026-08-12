import type {
  Api,
  AuthContext,
  CredentialStore,
  Model,
  Models,
  MutableModels,
} from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

export type ModelRef = {
  providerId: string;
  modelId: string;
};

export type ProviderSummary = {
  id: string;
  name: string;
  configured: boolean;
  authSource?: string;
  modelCount: number;
};

export type ModelSummary = {
  id: string;
  name: string;
  providerId: string;
  reasoning: boolean;
  input: readonly string[];
  contextWindow: number;
  maxTokens: number;
};

export type CustomOpenAiProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  modelIds: readonly string[];
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
    const providerModels = provider.modelIds.map(
      (id) =>
        ({
          id,
          name: id,
          api: "openai-completions",
          provider: provider.id,
          baseUrl: provider.baseUrl,
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 8_192,
        }) satisfies Model<"openai-completions">,
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

  getRawModels() {
    return this.models;
  }

  async listProviders(): Promise<ProviderSummary[]> {
    return Promise.all(
      this.models.getProviders().map(async (provider) => {
        try {
          const auth = await this.models.checkAuth(provider.id);
          return {
            id: provider.id,
            name: provider.name,
            configured: auth !== undefined,
            ...(auth?.source ? { authSource: auth.source } : {}),
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
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }));
  }

  async getAvailableModels(): Promise<ModelSummary[]> {
    const available = await this.models.getAvailable();
    return available.map((model) => ({
      id: model.id,
      name: model.name,
      providerId: model.provider,
      reasoning: model.reasoning,
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
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

  async resolve(ref: ModelRef): Promise<Model<Api>> {
    const model = this.models.getModel(ref.providerId, ref.modelId);
    if (!model) {
      throw new Error(
        `Model ${ref.providerId}/${ref.modelId} is not available`,
      );
    }

    const auth = await this.models.getAuth(model);
    if (!auth) {
      throw new Error(`Provider ${ref.providerId} is not configured`);
    }

    return model;
  }

  streamSimple: Models["streamSimple"] = (model, context, options) =>
    this.models.streamSimple(model, context, options);
}

export function createModelCatalog(
  options: CreateModelCatalogOptions = {},
): ModelCatalog {
  const models = builtinModels({
    ...(options.credentials ? { credentials: options.credentials } : {}),
    ...(options.authContext ? { authContext: options.authContext } : {}),
  });
  registerCustomProviders(models, options.customProviders ?? []);
  return new ModelCatalog(models);
}

export function createModelCatalogFromModels(models: Models): ModelCatalog {
  return new ModelCatalog(models);
}
