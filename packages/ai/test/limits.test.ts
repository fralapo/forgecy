import { describe, expect, it } from "vitest";
import {
  AiProviderError,
  createGoogleImageProvider,
  createOpenRouterImageProvider,
} from "../src/index";
import { MAX_JSON_BYTES, readJson, readText } from "../src/http";

/** An endless body that counts how many chunks were actually pulled. */
function endless(size: number) {
  const state = { pulled: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      state.pulled++;
      c.enqueue(new Uint8Array(size).fill(65));
    },
  });
  return { state, body };
}

describe("readText / readJson", () => {
  it("readText stops at the cap instead of buffering the body", async () => {
    const { state, body } = endless(1024);
    expect(await readText(new Response(body), 100)).toHaveLength(100);
    expect(state.pulled).toBeLessThan(10);
  });
  it("readText defaults to a 4 KiB head and never throws", async () => {
    expect(await readText(new Response("x".repeat(10_000)))).toHaveLength(4096);
    const broken = new Response(
      new ReadableStream({
        pull() {
          throw new Error("boom");
        },
      }),
    );
    expect(await readText(broken)).toBe("");
  });
  it("readJson parses, and refuses an oversized or malformed answer", async () => {
    expect(MAX_JSON_BYTES).toBe(64 * 1024 * 1024);
    expect(await readJson(new Response('{"a":1}'), "openrouter", 50)).toEqual({ a: 1 });
    await expect(
      readJson(new Response(JSON.stringify({ a: "x".repeat(100) })), "openrouter", 50),
    ).rejects.toMatchObject({ kind: "invalid_output" });
    await expect(readJson(new Response("not json"), "google")).rejects.toBeInstanceOf(
      AiProviderError,
    );
  });
  it("readJson stops pulling an endless body", async () => {
    const { state, body } = endless(1024);
    await expect(readJson(new Response(body), "google", 4096)).rejects.toBeInstanceOf(
      AiProviderError,
    );
    expect(state.pulled).toBeLessThan(10);
  });
});

describe("image providers bound the answer they read", () => {
  const input = {
    model: "m",
    prompt: "p",
    size: { w: 1080, h: 1350 },
    variants: 1 as const,
    timeoutMs: 1000,
  };
  it.each([
    ["google", (f: typeof fetch) => createGoogleImageProvider({ apiKey: "k", fetch: f })],
    ["openrouter", (f: typeof fetch) => createOpenRouterImageProvider({ apiKey: "k", fetch: f })],
  ] as const)("%s does not buffer an endless error body", async (_name, make) => {
    const { state, body } = endless(1024);
    const doFetch = (async () => new Response(body, { status: 400 })) as typeof fetch;
    await expect(make(doFetch).generate(input)).rejects.toBeInstanceOf(AiProviderError);
    expect(state.pulled).toBeLessThan(20);
  });
});
