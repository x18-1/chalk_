import {
  createModels,
  createProvider,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const DEFAULT_BASE_URL = "https://premium.hezubus.cc/v1";
const DEFAULT_MODEL_ID = "gpt-5.6-sol";
type GeometryApi = "openai-responses" | "openai-completions";

export type GeometryModelConfig = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  api?: GeometryApi;
};

export type GeometryModelClient = {
  models: Models;
  model: Model<GeometryApi>;
};

export function resolveModelConfig(
  env: Record<string, string | undefined> = process.env,
): GeometryModelConfig {
  const apiKey = env.GEOMETRY_AGENT_API_KEY?.trim();
  if (!apiKey) throw new Error("GEOMETRY_AGENT_API_KEY is required");

  return {
    apiKey,
    baseUrl: (env.GEOMETRY_AGENT_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    modelId: env.GEOMETRY_AGENT_MODEL?.trim() || DEFAULT_MODEL_ID,
    api: env.GEOMETRY_AGENT_API?.trim() === "openai-completions" ? "openai-completions" : "openai-responses",
  };
}

export function createGeometryModelClient(
  config: GeometryModelConfig,
): GeometryModelClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const model = {
    id: config.modelId,
    name: config.modelId,
    provider: "openai",
    api: config.api ?? "openai-responses",
    baseUrl,
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 8_192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsDeveloperRole: true,
      supportsStrictMode: false,
      sessionAffinityFormat: "openai-nosession",
    },
  } as Model<GeometryApi>;

  const provider = createProvider({
    id: "openai",
    name: "Geometry Agent OpenAI-Compatible Gateway",
    baseUrl,
    auth: {
      apiKey: {
        name: "Geometry Agent API key",
        resolve: async () => ({ auth: { apiKey: config.apiKey } }),
      },
    },
    models: [model],
    api: {
      "openai-responses": openAIResponsesApi(),
      "openai-completions": openAICompletionsApi(),
    },
  });
  const models = createModels();
  models.setProvider(provider);

  return { models, model };
}

export function createGeometryModelClientFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  return createGeometryModelClient(resolveModelConfig(env));
}
