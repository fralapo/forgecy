import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import {
  computeCost,
  createOpenAICompatibleProvider,
  createOpenRouterImageProvider,
  createProvidersFromEnv,
  defaultRoutingFromEnv,
  imageProviderOrder,
  type AiEnv,
} from "../src/index";

type Captured = { url: string; body: Record<string, unknown>; headers: Headers };

function fakeFetch(captured: Captured[], response: unknown, status = 200): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const schema = {
  type: "object",
  properties: { a: { type: "string" } },
  required: ["a"],
  additionalProperties: false,
};

describe("deepseek (json_object mode)", () => {
  it("puts the schema in the system prompt, sends json_object and reads cache hits", async () => {
    const captured: Captured[] = [];
    const client = new OpenAI({
      apiKey: "k",
      baseURL: "https://api.deepseek.com",
      maxRetries: 0,
      fetch: fakeFetch(captured, {
        id: "c1",
        object: "chat.completion",
        created: 0,
        model: "deepseek-flash",
        choices: [
          { index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"a":"x"}' } },
        ],
        usage: {
          prompt_tokens: 40,
          completion_tokens: 5,
          total_tokens: 45,
          prompt_cache_hit_tokens: 30,
        },
      }),
    });
    const res = await createOpenAICompatibleProvider({
      id: "deepseek",
      apiKey: "k",
      jsonMode: "json_object",
      client,
    }).generateObject({
      model: "deepseek-flash",
      system: "SYS",
      messages: [{ role: "user", content: "hi" }],
      jsonSchema: schema,
      schemaName: "outline",
      maxOutputTokens: 500,
      timeoutMs: 5000,
    });
    const body = captured[0]!.body;
    expect(captured[0]!.url).toBe("https://api.deepseek.com/chat/completions");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(500);
    const system = (body.messages as Array<{ content: string }>)[0]!.content;
    expect(system.startsWith("SYS")).toBe(true);
    expect(system).toContain("JSON");
    expect(system).toContain(JSON.stringify(schema));
    expect(res.parsed).toEqual({ a: "x" });
    expect(res.usage).toMatchObject({ inputTokens: 10, cacheReadTokens: 30, outputTokens: 5 });
  });

  it("prices DeepSeek models from the table", () => {
    const cost = computeCost("deepseek", "deepseek-flash", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(cost.priced).toBe(true);
    expect(cost.costMicroUsd).toBeGreaterThan(0);
  });
});

describe("openrouter images", () => {
  const png = Buffer.from([1, 2, 3]).toString("base64");

  it("asks for image modality with the nearest aspect ratio and decodes data URLs", async () => {
    const captured: Captured[] = [];
    const provider = createOpenRouterImageProvider({
      apiKey: "sk-or",
      defaultHeaders: { "X-Title": "Forgecy" },
      fetch: fakeFetch(captured, {
        model: "google/gemini-3.1-flash-image-preview",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "",
              images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png}` } }],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 1290, cost: 0.039 },
      }),
    });
    const job = await provider.generate({
      model: "google/gemini-3.1-flash-image-preview",
      prompt: "p",
      size: { w: 1080, h: 1350 },
      variants: 2,
      timeoutMs: 1000,
    });
    expect(captured).toHaveLength(2);
    expect(captured[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(captured[0]!.headers.get("authorization")).toBe("Bearer sk-or");
    expect(captured[0]!.headers.get("x-title")).toBe("Forgecy");
    expect(captured[0]!.body).toMatchObject({
      modalities: ["image", "text"],
      image_config: { aspect_ratio: "4:5" },
    });
    expect(job.state).toBe("succeeded");
    expect(job.images).toHaveLength(2);
    expect(job.images![0]!.mimeType).toBe("image/png");
    expect(Array.from(job.images![0]!.data)).toEqual([1, 2, 3]);
    expect(job.usage?.images).toBe(2);
    expect(job.usage?.providerCostUsd).toBeCloseTo(0.078);
  });

  it("fails with invalid_output when no image comes back, and maps HTTP errors", async () => {
    const empty = createOpenRouterImageProvider({
      apiKey: "k",
      fetch: fakeFetch([], { choices: [{ message: { content: "sorry" } }] }),
    });
    const input = {
      model: "m",
      prompt: "p",
      size: { w: 1, h: 1 },
      variants: 1 as const,
      timeoutMs: 1000,
    };
    await expect(empty.generate(input)).rejects.toMatchObject({ kind: "invalid_output" });
    const limited = createOpenRouterImageProvider({
      apiKey: "k",
      fetch: fakeFetch([], { error: "slow down" }, 429),
    });
    await expect(limited.generate(input)).rejects.toMatchObject({ kind: "rate_limit" });
  });
});

describe("registry", () => {
  const base: AiEnv = { AI_DEFAULT_PROVIDER: "deepseek", LOCAL_LLM_ENABLED: false } as AiEnv;

  it("registers DeepSeek for text and OpenRouter for text and images", () => {
    const set = createProvidersFromEnv({
      ...base,
      DEEPSEEK_API_KEY: "d",
      OPENROUTER_API_KEY: "o",
    });
    expect(Object.keys(set.text).sort()).toEqual(["deepseek", "openrouter"]);
    expect(Object.keys(set.image)).toEqual(["openrouter"]);
    const routing = defaultRoutingFromEnv(
      { ...base, DEEPSEEK_API_KEY: "d", OPENROUTER_API_KEY: "o", OPENROUTER_IMAGE_MODEL: "x/y" },
      set,
    );
    expect(routing.default.primary).toEqual({ provider: "deepseek", model: "deepseek-flash" });
    expect(routing.image).toEqual({ primary: { provider: "openrouter", model: "x/y" } });
  });

  it("orders image providers by IMAGE_PROVIDERS and ignores unknown names", () => {
    expect(imageProviderOrder({})).toEqual(["openrouter", "openai", "google", "higgsfield"]);
    expect(imageProviderOrder({ IMAGE_PROVIDERS: " openrouter, nope ,openai,openrouter" })).toEqual(
      ["openrouter", "openai"],
    );
    const routing = defaultRoutingFromEnv({
      ...base,
      OPENAI_API_KEY: "a",
      OPENROUTER_API_KEY: "o",
      IMAGE_PROVIDERS: "openrouter,openai",
    });
    expect(routing.image?.primary.provider).toBe("openrouter");
    expect(routing.image?.fallback?.provider).toBe("openai");
  });
});
