import { beforeEach, describe, expect, it } from "vitest";
import {
  clearModelCatalogCache,
  fetchModelCatalog,
  modelListHeaders,
  MODEL_LIST_ENDPOINTS,
} from "../src/providers/model-catalog";

function fakeFetch(data: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ data }), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("model-catalog", () => {
  beforeEach(() => clearModelCatalogCache());

  it("normalizes OpenAI's list (created in unix seconds, no name field)", async () => {
    const models = await fetchModelCatalog(
      "openai",
      "k",
      fakeFetch([{ id: "gpt-6.1-sol", object: "model", created: 100, owned_by: "openai" }]),
    );
    expect(models).toEqual([
      { id: "gpt-6.1-sol", name: "gpt-6.1-sol", created: 100, imageCapable: false },
    ]);
  });

  it("normalizes Anthropic's list (created_at as an ISO string, with display_name)", async () => {
    const models = await fetchModelCatalog(
      "anthropic",
      "k",
      fakeFetch([
        {
          id: "claude-sonnet-5-5",
          display_name: "Claude Sonnet 5.5",
          created_at: "2026-01-01T00:00:00Z",
        },
      ]),
    );
    expect(models).toEqual([
      {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        created: Date.parse("2026-01-01T00:00:00Z") / 1000,
        imageCapable: false,
      },
    ]);
  });

  it("falls back to created: 0 when DeepSeek's list omits a timestamp", async () => {
    const models = await fetchModelCatalog("deepseek", "k", fakeFetch([{ id: "deepseek-flash" }]));
    expect(models).toEqual([
      { id: "deepseek-flash", name: "deepseek-flash", created: 0, imageCapable: false },
    ]);
  });

  it("marks OpenAI's GPT Image / DALL·E ids as image-capable, other ids as not", async () => {
    const models = await fetchModelCatalog(
      "openai",
      "k",
      fakeFetch([
        { id: "gpt-image-1", created: 1 },
        { id: "dall-e-3", created: 2 },
        { id: "gpt-5.1", created: 3 },
      ]),
    );
    expect(models.map((m) => [m.id, m.imageCapable])).toEqual([
      ["gpt-image-1", true],
      ["dall-e-3", true],
      ["gpt-5.1", false],
    ]);
  });

  it("marks OpenRouter models image-capable from architecture.output_modalities", async () => {
    const models = await fetchModelCatalog(
      "openrouter",
      undefined,
      fakeFetch([
        { id: "openai/gpt-image-1", created: 1, architecture: { output_modalities: ["image"] } },
        {
          id: "deepseek/deepseek-v4-flash",
          created: 2,
          architecture: { output_modalities: ["text"] },
        },
        { id: "no-architecture/model", created: 3 },
      ]),
    );
    expect(models.map((m) => [m.id, m.imageCapable])).toEqual([
      ["openai/gpt-image-1", true],
      ["deepseek/deepseek-v4-flash", false],
      ["no-architecture/model", false],
    ]);
  });

  it("sends the right auth header per provider", () => {
    expect(modelListHeaders("anthropic", "k")).toEqual({
      "x-api-key": "k",
      "anthropic-version": "2023-06-01",
    });
    expect(modelListHeaders("openai", "k")).toEqual({ Authorization: "Bearer k" });
    expect(modelListHeaders("openrouter", undefined)).toEqual({});
  });

  it("caches per provider and key presence, and throws on an HTTP failure", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (...args) => {
      calls++;
      return fakeFetch([{ id: "m", created: 1 }])(...args);
    };
    await fetchModelCatalog("openai", "k", fetchImpl);
    await fetchModelCatalog("openai", "k", fetchImpl);
    expect(calls).toBe(1);
    await expect(fetchModelCatalog("openai", undefined, fakeFetch({}, false))).rejects.toThrow();
  });

  it("exposes every BYOK provider's endpoint", () => {
    expect(MODEL_LIST_ENDPOINTS.openai).toContain("api.openai.com");
    expect(MODEL_LIST_ENDPOINTS.anthropic).toContain("api.anthropic.com");
    expect(MODEL_LIST_ENDPOINTS.openrouter).toContain("openrouter.ai");
    expect(MODEL_LIST_ENDPOINTS.deepseek).toContain("api.deepseek.com");
  });
});
