import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
  createModelCatalog,
  createModelCatalogFromModels,
  EXCLUDED_MODEL_PROVIDER_IDS,
} from "../../src/models/model-catalog";

describe("model catalog", () => {
  it("omits product-excluded built-in providers", async () => {
    const providers = await createModelCatalog().listProviders();
    const providerIds = providers.map((provider) => provider.id);

    expect(providerIds).not.toEqual(
      expect.arrayContaining([...EXCLUDED_MODEL_PROVIDER_IDS]),
    );
  });

  it("keeps user-defined providers in the same catalog", async () => {
    const customProviderId = "85e6fc6a-1f83-41ad-826f-884fc29a71df";
    const providers = await createModelCatalog({
      customProviders: [
        {
          id: customProviderId,
          name: "School Gateway",
          baseUrl: "https://models.example.test/v1",
          apiKey: "test-key",
          models: [{
            id: "school-model",
            name: "School Model",
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 256_000,
            maxTokens: 16_000,
            cost: { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1.25 },
          }],
        },
      ],
    }).listProviders();

    expect(providers).toContainEqual(
      expect.objectContaining({
        id: customProviderId,
        name: "School Gateway",
        configured: true,
        modelCount: 1,
      }),
    );
    expect(createModelCatalog({
      customProviders: [{
        id: customProviderId,
        name: "School Gateway",
        baseUrl: "https://models.example.test/v1",
        apiKey: "test-key",
        models: [{
          id: "school-model",
          name: "School Model",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 256_000,
          maxTokens: 16_000,
          cost: { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1.25 },
        }],
      }],
    }).listModels(customProviderId)).toContainEqual(expect.objectContaining({
      id: "school-model",
      name: "School Model",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 256_000,
      maxTokens: 16_000,
      cost: { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1.25 },
    }));
  });

  it("tests a provider with a bounded real model request", async () => {
    const observeRequest = vi.fn();
    const faux = fauxProvider();
    faux.setResponses([
      (context, options) => {
        observeRequest(context, options);
        return fauxAssistantMessage("OK");
      },
    ]);
    const models = createModels();
    models.setProvider(faux.provider);

    const result = await createModelCatalogFromModels(models).testConnection({
      providerId: faux.provider.id,
      modelId: faux.getModel().id,
    });

    expect(result).toMatchObject({
      providerId: faux.provider.id,
      modelId: faux.getModel().id,
    });
    expect(observeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ role: "user" })],
      }),
      expect.objectContaining({
        maxTokens: 8,
        maxRetries: 0,
        timeoutMs: 15_000,
      }),
    );
  });
});
