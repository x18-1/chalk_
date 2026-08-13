import { describe, expect, it } from "vitest";

import { createGeometryModelClient, resolveModelConfig } from "../src/model";

describe("geometry model configuration", () => {
  it("uses the configured Responses endpoint and requested model", async () => {
    const client = createGeometryModelClient({
      apiKey: "test-key",
      baseUrl: "https://gateway.example.test/v1/",
      modelId: "gpt-5.6-sol",
    });

    expect(client.model).toMatchObject({
      id: "gpt-5.6-sol",
      provider: "openai",
      api: "openai-responses",
      baseUrl: "https://gateway.example.test/v1",
      input: ["text", "image"],
    });
    expect(await client.models.checkAuth("openai")).toBeDefined();
  });

  it("fails closed when the API key is absent", () => {
    expect(() => resolveModelConfig({})).toThrow(
      "GEOMETRY_AGENT_API_KEY is required",
    );
  });
});
