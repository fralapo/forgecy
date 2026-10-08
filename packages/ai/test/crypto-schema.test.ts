import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  classifyError,
  computeCost,
  decryptSecret,
  encryptSecret,
  generateEncryptionKey,
  isStrictCompatible,
  keyHint,
  toAnthropicSchema,
  zodToJsonSchema,
} from "../src/index";

describe("crypto", () => {
  const key = generateEncryptionKey();

  it("round-trips a BYOK key", () => {
    const secret = "sk-ant-api03-abcdefghijklmnop-WXYZ";
    const enc = encryptSecret(secret, key);
    expect(enc).not.toContain(secret);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptSecret(enc, key)).toBe(secret);
    expect(keyHint(secret)).toBe("WXYZ");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("rejects a wrong key or tampered data", () => {
    const enc = encryptSecret("secret", key);
    expect(() => decryptSecret(enc, generateEncryptionKey())).toThrow(/could not be decrypted/);
    const raw = Buffer.from(enc.slice(3), "base64");
    raw[raw.length - 1]! ^= 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`, key)).toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => encryptSecret("x", undefined)).toThrow(/FORGECY_ENCRYPTION_KEY/);
  });
});

describe("schema helpers", () => {
  const s = z.object({
    kind: z.enum(["a", "b"]),
    title: z.string().max(40),
    note: z.string().optional(),
  });

  it("keeps enums and moves unsupported constraints to description for Anthropic", () => {
    const out = toAnthropicSchema(zodToJsonSchema(s)) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(out.properties.kind!.enum).toEqual(["a", "b"]);
    expect(out.properties.title!.maxLength).toBeUndefined();
    expect(out.properties.title!.description).toMatch(/maxLength: 40/);
  });

  it("detects OpenAI strict compatibility", () => {
    expect(isStrictCompatible(zodToJsonSchema(s))).toBe(false);
    expect(isStrictCompatible(zodToJsonSchema(s.required()))).toBe(true);
  });
});

describe("errors and pricing", () => {
  it("classifies SDK-like errors", () => {
    expect(classifyError({ name: "RateLimitError", status: 429, message: "slow" }).retryable).toBe(
      true,
    );
    expect(
      classifyError({ name: "InternalServerError", status: 529, message: "overloaded" }).kind,
    ).toBe("server");
    expect(classifyError({ name: "BadRequestError", status: 400, message: "bad" }).retryable).toBe(
      false,
    );
    expect(classifyError({ name: "APIConnectionTimeoutError", message: "t" }).kind).toBe("timeout");
    expect(classifyError(new TypeError("fetch failed")).kind).toBe("network");
  });

  it("computes cost in micro-USD with cache tokens", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    };
    expect(computeCost("anthropic", "claude-opus-5-5", usage)).toEqual({
      costMicroUsd: 4_200_000,
      priced: true,
    });
    expect(computeCost("local", "anything", usage).costMicroUsd).toBe(0);
    // Not in the table: charged at the conservative default so budgets still bite.
    // 1M input * $15/M + 1M cache read * ($15 * 10%)/M = $16.5
    expect(computeCost("openai", "unknown-model", usage)).toEqual({
      costMicroUsd: 16_500_000,
      priced: false,
    });
  });
});
