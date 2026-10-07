import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOpenRouterCatalogCache,
  fetchOpenRouterCatalog,
  latestDeepSeekFlashChat,
  latestOpenAiImageModel,
  resolveOpenRouterLiveDefaults,
  type OpenRouterModelInfo,
} from "../src/providers/openrouter-catalog";

function fakeFetch(data: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ data }), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

const catalog = [
  { id: "deepseek/deepseek-v3-flash", name: "DeepSeek V3 Flash", created: 100 },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", created: 300 },
  { id: "deepseek/deepseek-v4-flash:batch", name: "DeepSeek V4 Flash (batch)", created: 300 },
  { id: "~deepseek/deepseek-flash-latest", name: "DeepSeek Flash Latest (alias)", created: 999 },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", created: 400 },
  { id: "openai/gpt-image-1", name: "GPT Image 1", created: 200 },
  { id: "openai/gpt-image-2", name: "GPT Image 2", created: 350 },
  { id: "openai/gpt-6.1-sol", name: "GPT 6.1 Sol", created: 500 },
  { id: "anthropic/claude-sonnet", name: "Claude Sonnet", created: 600 },
];

describe("openrouter-catalog", () => {
  beforeEach(() => clearOpenRouterCatalogCache());

  it("picks the newest canonical DeepSeek Flash id, ignoring aliases and batch variants", () => {
    const models = catalog as OpenRouterModelInfo[];
    expect(latestDeepSeekFlashChat(models)).toBe("deepseek/deepseek-v4-flash");
  });

  it("picks the newest OpenAI image-generation id", () => {
    const models = catalog as OpenRouterModelInfo[];
    expect(latestOpenAiImageModel(models)).toBe("openai/gpt-image-2");
  });

  it("fetches and caches the catalog", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (...args) => {
      calls++;
      return fakeFetch(catalog)(...args);
    };
    const first = await fetchOpenRouterCatalog(fetchImpl);
    const second = await fetchOpenRouterCatalog(fetchImpl);
    expect(first).toEqual(second);
    expect(calls).toBe(1);
  });

  it("resolveOpenRouterLiveDefaults swallows a fetch failure", async () => {
    const result = await resolveOpenRouterLiveDefaults(fakeFetch({}, false));
    expect(result).toEqual({});
  });

  it("resolveOpenRouterLiveDefaults returns both picks when the catalog is reachable", async () => {
    const result = await resolveOpenRouterLiveDefaults(fakeFetch(catalog));
    expect(result).toEqual({ text: "deepseek/deepseek-v4-flash", image: "openai/gpt-image-2" });
  });
});
