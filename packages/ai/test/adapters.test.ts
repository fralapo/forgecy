import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import {
  createAnthropicProvider,
  createGoogleImageProvider,
  createOpenAICompatibleProvider,
  createOpenAIImageProvider,
} from "../src/index";

type Captured = { url: string; body: Record<string, unknown> };

function fakeFetch(captured: Captured[], response: unknown, status = 200): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const req = {
  model: "m",
  system: "SYS",
  messages: [{ role: "user" as const, content: "hi" }],
  jsonSchema: {
    type: "object",
    properties: { a: { type: "string" } },
    required: ["a"],
    additionalProperties: false,
  },
  schemaName: "outline",
  maxOutputTokens: 1000,
  timeoutMs: 5000,
};

describe("anthropic adapter", () => {
  it("sends output_config.format and a cached system block; reads usage", async () => {
    const captured: Captured[] = [];
    const client = new Anthropic({
      apiKey: "k",
      maxRetries: 0,
      fetch: fakeFetch(captured, {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: '{"a":"x"}' }],
        stop_reason: "end_turn",
        stop_details: null,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
      }),
    });
    const res = await createAnthropicProvider({ apiKey: "k", client }).generateObject(req);
    const body = captured[0]!.body;
    expect(body.output_config).toEqual({ format: { type: "json_schema", schema: req.jsonSchema } });
    expect(body.system).toEqual([
      { type: "text", text: "SYS", cache_control: { type: "ephemeral" } },
    ]);
    expect(res.parsed).toEqual({ a: "x" });
    expect(res.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 });
  });

  it("maps refusal and 429", async () => {
    const refused = new Anthropic({
      apiKey: "k",
      maxRetries: 0,
      fetch: fakeFetch([], {
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "nope" },
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      }),
    });
    const res = await createAnthropicProvider({ apiKey: "k", client: refused }).generateObject(req);
    expect(res).toMatchObject({ stopReason: "refusal", refusal: "nope", text: "" });

    const limited = new Anthropic({
      apiKey: "k",
      maxRetries: 0,
      fetch: fakeFetch(
        [],
        { type: "error", error: { type: "rate_limit_error", message: "slow" } },
        429,
      ),
    });
    await expect(
      createAnthropicProvider({ apiKey: "k", client: limited }).generateObject(req),
    ).rejects.toMatchObject({ kind: "rate_limit", retryable: true });
  });
});

describe("openai-compatible adapter", () => {
  it("sends response_format json_schema (strict when possible) and subtracts cached tokens", async () => {
    const captured: Captured[] = [];
    const client = new OpenAI({
      apiKey: "k",
      maxRetries: 0,
      fetch: fakeFetch(captured, {
        id: "c1",
        object: "chat.completion",
        created: 0,
        model: "gpt-6.1-sol",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: '{"a":"y"}', refusal: null },
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 7,
          total_tokens: 57,
          prompt_tokens_details: { cached_tokens: 20 },
        },
      }),
    });
    const res = await createOpenAICompatibleProvider({
      id: "openai",
      apiKey: "k",
      client,
    }).generateObject(req);
    const body = captured[0]!.body;
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "outline", schema: req.jsonSchema, strict: true },
    });
    expect(body.max_completion_tokens).toBe(1000);
    expect((body.messages as unknown[])[0]).toEqual({ role: "system", content: "SYS" });
    expect(res.usage).toMatchObject({ inputTokens: 30, cacheReadTokens: 20, outputTokens: 7 });
    expect(res.parsed).toEqual({ a: "y" });
  });

  it("uses max_tokens for local servers and maps refusal", async () => {
    const captured: Captured[] = [];
    const client = new OpenAI({
      apiKey: "local",
      baseURL: "http://localhost:11434/v1",
      maxRetries: 0,
      fetch: fakeFetch(captured, {
        id: "c2",
        object: "chat.completion",
        created: 0,
        model: "llama3.1:8b",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: null, refusal: "no" },
          },
        ],
      }),
    });
    const res = await createOpenAICompatibleProvider({
      id: "local",
      apiKey: "local",
      client,
    }).generateObject(req);
    expect(captured[0]!.body.max_tokens).toBe(1000);
    expect(captured[0]!.url).toContain("localhost:11434/v1/chat/completions");
    expect(res.stopReason).toBe("refusal");
  });
});

describe("vision input in text adapters", () => {
  const img = { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" as const };
  const visionReq = {
    ...req,
    messages: [{ role: "user" as const, content: "describe", images: [img] }],
  };
  const b64 = Buffer.from(img.data).toString("base64");

  it("anthropic sends base64 image blocks before the text", async () => {
    const captured: Captured[] = [];
    const client = new Anthropic({
      apiKey: "k",
      maxRetries: 0,
      fetch: fakeFetch(captured, {
        id: "msg_v",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: '{"a":"x"}' }],
        stop_reason: "end_turn",
        stop_details: null,
        stop_sequence: null,
        usage: { input_tokens: 1500, output_tokens: 5 },
      }),
    });
    await createAnthropicProvider({ apiKey: "k", client }).generateObject(visionReq);
    expect((captured[0]!.body.messages as unknown[])[0]).toEqual({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
        { type: "text", text: "describe" },
      ],
    });
  });

  it("openai-compatible sends data URL image parts", async () => {
    const captured: Captured[] = [];
    const client = new OpenAI({
      apiKey: "k",
      maxRetries: 0,
      fetch: fakeFetch(captured, {
        id: "c_v",
        object: "chat.completion",
        created: 0,
        model: "gpt-6.1-sol",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: '{"a":"y"}', refusal: null },
          },
        ],
      }),
    });
    await createOpenAICompatibleProvider({ id: "openai", apiKey: "k", client }).generateObject(
      visionReq,
    );
    expect((captured[0]!.body.messages as unknown[])[1]).toEqual({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        { type: "text", text: "describe" },
      ],
    });
  });
});

describe("image adapters", () => {
  const png = Buffer.from([1, 2, 3]).toString("base64");

  it("openai decodes b64_json", async () => {
    const captured: Captured[] = [];
    const client = new OpenAI({
      apiKey: "k",
      maxRetries: 0,
      fetch: fakeFetch(captured, { created: 0, data: [{ b64_json: png }, { b64_json: png }] }),
    });
    const job = await createOpenAIImageProvider({ apiKey: "k", client }).generate({
      model: "gpt-image-2",
      prompt: "p",
      size: { w: 1080, h: 1350 },
      variants: 2,
      timeoutMs: 1000,
    });
    expect(captured[0]!.body).toMatchObject({ model: "gpt-image-2", n: 2, size: "1024x1536" });
    expect(job.state).toBe("succeeded");
    expect(Array.from(job.images![0]!.data)).toEqual([1, 2, 3]);
  });

  it("openai reports the usage it was billed when no image comes back", async () => {
    const client = new OpenAI({
      apiKey: "k",
      maxRetries: 0,
      fetch: fakeFetch([], { created: 0, data: [], usage: { input_tokens: 7, output_tokens: 90 } }),
    });
    await expect(
      createOpenAIImageProvider({ apiKey: "k", client }).generate({
        model: "gpt-image-2",
        prompt: "p",
        size: { w: 1, h: 1 },
        variants: 1,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({
      kind: "invalid_output",
      usage: { inputTokens: 7, outputTokens: 90 },
    });
  });

  it("google reports the images already billed when a later variant fails", async () => {
    let n = 0;
    const provider = createGoogleImageProvider({
      apiKey: "k",
      fetch: (async () =>
        ++n === 1
          ? Response.json({
              candidates: [
                { content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } },
              ],
              usageMetadata: { promptTokenCount: 5 },
            })
          : Response.json({ error: "down" }, { status: 503 })) as typeof fetch,
    });
    await expect(
      provider.generate({
        model: "gemini-3.1-flash-image",
        prompt: "p",
        size: { w: 1, h: 1 },
        variants: 2,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ kind: "server", usage: { inputTokens: 5, images: 1 } });
  });

  it("google parses inlineData", async () => {
    const captured: Captured[] = [];
    const provider = createGoogleImageProvider({
      apiKey: "k",
      fetch: fakeFetch(captured, {
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } },
        ],
        usageMetadata: { promptTokenCount: 5 },
      }),
    });
    const job = await provider.generate({
      model: "gemini-3.1-flash-image",
      prompt: "p",
      size: { w: 1080, h: 1350 },
      variants: 1,
      timeoutMs: 1000,
    });
    expect(captured[0]!.url).toContain("models/gemini-3.1-flash-image:generateContent");
    expect(captured[0]!.body).toMatchObject({
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5" } },
    });
    expect(job.images).toHaveLength(1);
  });
});
