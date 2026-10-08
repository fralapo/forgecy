import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ForgecyError } from "@forgecy/core";
import {
  AiProviderError,
  createAiGateway,
  createFakeImageProvider,
  createFakeTextProvider,
  createMemoryLedger,
  monthKey,
  type AiLedger,
  type Routing,
} from "../src/index";

const NOW = new Date("2026-10-05T10:00:00Z");
const schema = z.object({ title: z.string().min(3), slides: z.number().int().min(1) });
const SECRET = "Rossi client: secret launch of product X";

function setup(opts: { routing?: Partial<Routing>; local?: boolean } = {}) {
  const ledger = createMemoryLedger();
  const anthropic = createFakeTextProvider("anthropic");
  const openai = createFakeTextProvider("openai");
  const local = createFakeTextProvider("local");
  const warnings: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  const routing: Routing = {
    default: {
      primary: { provider: "anthropic", model: "claude-opus-5-5" },
      fallback: { provider: "openai", model: "gpt-6.1-sol" },
    },
    local: { provider: "local", model: "llama3.1:8b" },
    image: { primary: { provider: "openai", model: "gpt-image-2" } },
    ...opts.routing,
  };
  const gateway = createAiGateway({
    ledger,
    providers: {
      text: { anthropic, openai, ...(opts.local === false ? {} : { local }) },
      image: { openai: createFakeImageProvider("openai") },
    },
    routing,
    logger: { warn: (obj, msg) => warnings.push({ obj, ...(msg ? { msg } : {}) }) },
    now: () => NOW,
  });
  return { ledger, anthropic, openai, local, gateway, warnings };
}

const baseReq = {
  task: "outline" as const,
  schema,
  system: "You write carousel outlines.",
  input: SECRET,
  clientId: "11111111-1111-1111-1111-111111111111",
};

describe("policy", () => {
  it("no_ai blocks before any provider call and logs a blocked row", async () => {
    const { gateway, ledger, anthropic } = setup();
    await expect(
      gateway.generateObject({ ...baseReq, clientPolicy: "no_ai" }),
    ).rejects.toMatchObject({ code: "policy_blocked" });
    expect(anthropic.calls).toHaveLength(0);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      status: "blocked",
      policy: "no_ai",
      kind: "outline",
    });
  });

  it("local_only routes to the local model, never to cloud", async () => {
    const { gateway, anthropic, openai, local } = setup();
    local.push({ error: "server", status: 503 });
    await expect(
      gateway.generateObject({ ...baseReq, clientPolicy: "local_only" }),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(local.calls).toHaveLength(1);
    expect(anthropic.calls).toHaveLength(0);
    expect(openai.calls).toHaveLength(0);
  });

  it("local_only without a local provider stops with a clear error", async () => {
    const { gateway, anthropic, ledger } = setup({ local: false });
    await expect(
      gateway.generateObject({ ...baseReq, clientPolicy: "local_only" }),
    ).rejects.toThrow(/local_only/);
    expect(anthropic.calls).toHaveLength(0);
    expect(ledger.entries[0]?.status).toBe("blocked");
  });

  it("external_restricted uses only the providers approved for the client", async () => {
    const { gateway, anthropic, openai, ledger } = setup();
    ledger.setApprovedProviders(baseReq.clientId, ["openai"]);
    openai.push({ json: { title: "Hook", slides: 7 } });
    const res = await gateway.generateObject({ ...baseReq, clientPolicy: "external_restricted" });
    expect(res.provider).toBe("openai");
    expect(anthropic.calls).toHaveLength(0);
    // A request can narrow the list (nothing confirmed yet) but never widen it.
    await expect(
      gateway.generateObject({
        ...baseReq,
        clientPolicy: "external_restricted",
        approvedProviders: [],
      }),
    ).rejects.toMatchObject({ code: "policy_blocked" });
    ledger.setApprovedProviders(baseReq.clientId, []);
    await expect(
      gateway.generateObject({
        ...baseReq,
        clientPolicy: "external_restricted",
        approvedProviders: ["anthropic", "openai"],
      }),
    ).rejects.toMatchObject({ code: "policy_blocked" });
    expect(anthropic.calls).toHaveLength(0);
  });
});

describe("files that may be sent (external_restricted)", () => {
  it("keeps a request with a kind the Admin did not allow on the local model", async () => {
    const { gateway, anthropic, openai, local, ledger } = setup();
    ledger.setApprovedProviders(baseReq.clientId, ["anthropic"]);
    ledger.setSendableAssets(baseReq.clientId, ["brand_texts"]);
    anthropic.push({ json: { title: "Allowed", slides: 3 } });
    const ok = await gateway.generateObject({
      ...baseReq,
      clientPolicy: "external_restricted",
      sends: ["brand_texts"],
    });
    expect(ok.provider).toBe("anthropic");
    local.push({ json: { title: "On site", slides: 3 } });
    const kept = await gateway.generateObject({
      ...baseReq,
      clientPolicy: "external_restricted",
      sends: ["audit_screenshots"],
    });
    expect(kept.provider).toBe("local");
    expect(anthropic.calls).toHaveLength(1);
    expect(openai.calls).toHaveLength(0);
  });

  it("blocks it when there is no local model, and ignores the rule for other policies", async () => {
    const { gateway, anthropic, ledger } = setup({ local: false });
    ledger.setApprovedProviders(baseReq.clientId, ["anthropic"]);
    ledger.setSendableAssets(baseReq.clientId, []);
    await expect(
      gateway.generateObject({
        ...baseReq,
        clientPolicy: "external_restricted",
        sends: ["documents"],
      }),
    ).rejects.toMatchObject({
      code: "policy_blocked",
      details: { reason: "asset_type_not_allowed" },
    });
    expect(anthropic.calls).toHaveLength(0);
    anthropic.push({ json: { title: "Allowed", slides: 3 } });
    const res = await gateway.generateObject({
      ...baseReq,
      clientPolicy: "external_allowed",
      sends: ["documents"],
    });
    expect(res.provider).toBe("anthropic");
  });
});

describe("external_restricted fails closed", () => {
  const clientId = baseReq.clientId;
  function gatewayWith(ledger: AiLedger) {
    const anthropic = createFakeTextProvider("anthropic");
    const local = createFakeTextProvider("local");
    const gateway = createAiGateway({
      ledger,
      providers: { text: { anthropic, local }, image: {} },
      routing: {
        default: { primary: { provider: "anthropic", model: "claude-opus-5-5" } },
        local: { provider: "local", model: "llama3.1:8b" },
        image: { primary: { provider: "openai", model: "gpt-image-2" } },
      },
      now: () => NOW,
    });
    return { gateway, anthropic, local };
  }
  const legacy = (extra: Partial<AiLedger> = {}): AiLedger => {
    const { monthSpendMicroUsd, budgetFor, record } = createMemoryLedger();
    return { monthSpendMicroUsd, budgetFor, record, ...extra };
  };

  it("a ledger that cannot say what the Admin approved approves nothing, whatever the request claims", async () => {
    const { gateway, anthropic } = gatewayWith(legacy());
    await expect(
      gateway.generateObject({
        ...baseReq,
        clientPolicy: "external_restricted",
        approvedProviders: ["anthropic"],
      }),
    ).rejects.toMatchObject({ code: "policy_blocked" });
    expect(anthropic.calls).toHaveLength(0);
  });

  it("a ledger that cannot list sendable kinds keeps files on the local model", async () => {
    const { gateway, anthropic, local } = gatewayWith(
      legacy({ approvedProviders: async () => ["anthropic"] }),
    );
    local.push({ json: { title: "On site", slides: 3 } });
    const res = await gateway.generateObject({
      ...baseReq,
      clientPolicy: "external_restricted",
      sends: ["documents"],
    });
    expect(res.provider).toBe("local");
    expect(anthropic.calls).toHaveLength(0);
  });

  it("no client id means nothing is approved and nothing may be sent", async () => {
    const ledger = createMemoryLedger();
    ledger.setApprovedProviders(clientId, ["anthropic"]);
    const { gateway, anthropic } = gatewayWith(ledger);
    await expect(
      gateway.generateObject({
        ...baseReq,
        clientId: undefined,
        clientPolicy: "external_restricted",
        sends: ["brand_texts"],
      }),
    ).rejects.toMatchObject({ code: "policy_blocked" });
    expect(anthropic.calls).toHaveLength(0);
  });
});

describe("structured output", () => {
  it("retries once with the validation error, then succeeds", async () => {
    const { gateway, anthropic, ledger } = setup();
    anthropic.push(
      { json: { title: "x", slides: 0 } },
      { json: { title: "Five mistakes", slides: 7 } },
    );
    const res = await gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" });
    expect(res.data).toEqual({ title: "Five mistakes", slides: 7 });
    expect(res.attempts).toBe(2);
    const retry = anthropic.calls[1]!;
    expect(retry.messages).toHaveLength(3);
    expect(retry.messages[2]!.content).toMatch(/title/);
    expect(retry.messages[2]!.content).toMatch(/slides/);
    expect(ledger.entries.map((e) => e.status)).toEqual(["error", "ok"]);
    expect(res.usage.inputTokens).toBe(200);
  });

  it("fails clearly after two invalid outputs", async () => {
    const { gateway, anthropic, openai } = setup();
    anthropic.push({ text: "not json" }, { json: { title: 1 } });
    const err = await gateway
      .generateObject({ ...baseReq, clientPolicy: "external_allowed" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.kind).toBe("invalid_output");
    expect(err.message).toMatch(/after 2 attempts/);
    expect(openai.calls).toHaveLength(0);
  });

  it("passes a JSON schema derived from zod to the provider", async () => {
    const { gateway, anthropic } = setup();
    anthropic.push({ json: { title: "Hello", slides: 3 } });
    await gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" });
    expect(anthropic.calls[0]!.jsonSchema).toMatchObject({
      type: "object",
      required: ["title", "slides"],
    });
  });
});

describe("errors and fallback", () => {
  it("falls back on 429", async () => {
    const { gateway, anthropic, openai, ledger } = setup();
    anthropic.push({ error: "rate_limit", status: 429 });
    openai.push({ json: { title: "Fallback", slides: 5 } });
    const res = await gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" });
    expect(res.provider).toBe("openai");
    expect(res.fallbackUsed).toBe(true);
    expect(ledger.entries.map((e) => [e.provider, e.status])).toEqual([
      ["anthropic", "error"],
      ["openai", "ok"],
    ]);
  });

  it("does not fall back on 400", async () => {
    const { gateway, anthropic, openai } = setup();
    anthropic.push({ error: "bad_request", status: 400 });
    await expect(
      gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" }),
    ).rejects.toMatchObject({
      kind: "bad_request",
      retryable: false,
    });
    expect(openai.calls).toHaveLength(0);
  });

  it("falls back on refusal", async () => {
    const { gateway, anthropic, openai } = setup();
    anthropic.push({ refusal: "declined" });
    openai.push({ json: { title: "Other", slides: 2 } });
    const res = await gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" });
    expect(res.provider).toBe("openai");
  });

  it("does not fall back when the fallback is not approved by policy", async () => {
    const { gateway, anthropic, openai, ledger } = setup();
    ledger.setApprovedProviders(baseReq.clientId, ["anthropic"]);
    anthropic.push({ error: "server", status: 503 });
    await expect(
      gateway.generateObject({ ...baseReq, clientPolicy: "external_restricted" }),
    ).rejects.toMatchObject({ kind: "server" });
    expect(openai.calls).toHaveLength(0);
  });

  it("reports max_tokens truncation without retrying", async () => {
    const { gateway, anthropic } = setup();
    anthropic.push({ maxTokens: '{"title":' });
    await expect(
      gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" }),
    ).rejects.toMatchObject({ kind: "max_tokens" });
    expect(anthropic.calls).toHaveLength(1);
  });
});

describe("budget", () => {
  const month = monthKey(NOW);

  it("warns at warn_at_percent", async () => {
    const { gateway, anthropic, ledger, warnings } = setup();
    ledger.setBudget({ scope: "client", clientId: baseReq.clientId }, month, {
      limitMicroUsd: 1_000_000,
      warnAtPercent: 70,
    });
    await ledger.record({
      kind: "outline",
      clientId: baseReq.clientId,
      status: "ok",
      inputSummary: {},
      tokensIn: 0,
      tokensOut: 0,
      costMicroUsd: 800_000,
      startedAt: NOW,
    });
    anthropic.push({ json: { title: "Hello", slides: 3 } });
    const res = await gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" });
    expect(res.budgetWarnings).toHaveLength(1);
    expect(res.budgetWarnings[0]).toMatchObject({ scope: "client", percent: 80 });
    expect(warnings.some((w) => w.msg?.includes("budget"))).toBe(true);
  });

  it("an unpriced model still consumes the budget and gets blocked", async () => {
    const { gateway, anthropic, ledger } = setup({
      routing: { default: { primary: { provider: "anthropic", model: "claude-future-9" } } },
    });
    ledger.setBudget({ scope: "agency" }, month, { limitMicroUsd: 5_000, warnAtPercent: 70 });
    anthropic.push({ json: { title: "Hello", slides: 3 } });
    await gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" });
    const err = await gateway
      .generateObject({ ...baseReq, clientPolicy: "external_allowed" })
      .catch((e) => e);
    expect(err.code).toBe("budget_exceeded");
    expect(anthropic.calls).toHaveLength(1);
  });

  it("blocks at 100% with budget_exceeded", async () => {
    const { gateway, anthropic, ledger } = setup();
    ledger.setBudget({ scope: "agency" }, month, { limitMicroUsd: 500_000, warnAtPercent: 70 });
    await ledger.record({
      kind: "slides",
      clientId: null,
      status: "ok",
      inputSummary: {},
      tokensIn: 0,
      tokensOut: 0,
      costMicroUsd: 500_000,
      startedAt: NOW,
    });
    const err = await gateway
      .generateObject({ ...baseReq, clientPolicy: "external_allowed" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForgecyError);
    expect(err.code).toBe("budget_exceeded");
    expect(anthropic.calls).toHaveLength(0);
    expect(ledger.entries.at(-1)).toMatchObject({ status: "blocked" });
  });

  it("ignores spend from previous months", async () => {
    const { gateway, anthropic, ledger } = setup();
    ledger.setBudget({ scope: "agency" }, month, { limitMicroUsd: 500_000, warnAtPercent: 70 });
    await ledger.record({
      kind: "slides",
      status: "ok",
      inputSummary: {},
      tokensIn: 0,
      tokensOut: 0,
      costMicroUsd: 900_000,
      startedAt: new Date("2026-09-30T23:59:00Z"),
    });
    anthropic.push({ json: { title: "Hello", slides: 3 } });
    await expect(
      gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" }),
    ).resolves.toBeTruthy();
  });
});

describe("ledger rows", () => {
  it("contain hashes and sizes, never raw input, and priced cost", async () => {
    const { gateway, anthropic, ledger } = setup();
    anthropic.push({
      json: { title: "Hello", slides: 3 },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    await gateway.generateObject({
      ...baseReq,
      clientPolicy: "external_allowed",
      authorizedBy: "22222222-2222-2222-2222-222222222222",
      inputSummary: {
        fields: { brief: "Confidential client brief" },
        assets: [{ id: "a_123", sha256: "abc" }],
      },
    });
    const row = ledger.entries[0]!;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("Confidential client");
    expect(serialized).not.toContain("You write carousel outlines");
    const fields = (
      row.inputSummary as { fields: Record<string, { sha256: string; bytes: number }> }
    ).fields;
    expect(Object.keys(fields).sort()).toEqual(["brief", "input", "system"]);
    expect(fields.input!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5-5",
      policy: "external_allowed",
      authorizedBy: "22222222-2222-2222-2222-222222222222",
    });
    // 1000 * $4/M + 500 * $20/M = $0.014 = 14_000 micro-USD
    expect(row.costMicroUsd).toBe(14_000);
  });

  it("charges unknown models at the conservative default and flags them", async () => {
    const { gateway, anthropic, ledger, warnings } = setup({
      routing: { default: { primary: { provider: "anthropic", model: "claude-future-9" } } },
    });
    anthropic.push({ json: { title: "Hello", slides: 3 } });
    await gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed" });
    // fake provider usage: 100 in / 50 out -> 100*15 + 50*75 = 5_250 micro-USD
    expect(ledger.entries[0]).toMatchObject({
      costMicroUsd: 5_250,
      inputSummary: expect.objectContaining({ unpriced: true }),
    });
    expect(warnings.some((w) => w.msg?.includes("price table"))).toBe(true);
  });
});

describe("images", () => {
  it("generates variants, logs a row, respects policy", async () => {
    const { gateway, ledger } = setup();
    const res = await gateway.generateImage({
      prompt: SECRET,
      size: { w: 1080, h: 1350 },
      variants: 2,
      clientId: baseReq.clientId,
      clientPolicy: "external_allowed",
    });
    expect(res.images).toHaveLength(2);
    expect(ledger.entries[0]).toMatchObject({ kind: "image", status: "ok", provider: "openai" });
    expect(JSON.stringify(ledger.entries)).not.toContain(SECRET);
    await expect(
      gateway.generateImage({
        prompt: "x",
        size: { w: 1, h: 1 },
        variants: 1,
        clientPolicy: "local_only",
      }),
    ).rejects.toMatchObject({ code: "policy_blocked" });
  });
});

describe("vision input", () => {
  const png = (tag: number) =>
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag]);
  const shot = { data: png(1), mimeType: "image/png" as const, id: "audit/ig-profile.png" };
  const ok = { title: "Profilo", slides: 3 };

  it("sends images on the first user turn and logs only hash, size and type", async () => {
    const { gateway, anthropic, ledger } = setup();
    anthropic.push({ json: ok });
    await gateway.generateObject({
      ...baseReq,
      task: "audit_analyze",
      clientPolicy: "external_allowed",
      images: [shot],
    });
    expect(anthropic.calls[0]!.messages[0]!.images).toHaveLength(1);
    const summary = ledger.entries[0]!.inputSummary as { images: unknown[] };
    expect(summary.images).toEqual([
      {
        id: "audit/ig-profile.png",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        bytes: 9,
        mimeType: "image/png",
      },
    ]);
    expect(JSON.stringify(ledger.entries)).not.toContain(Buffer.from(shot.data).toString("base64"));
  });

  it("keeps the images on the validation retry", async () => {
    const { gateway, anthropic } = setup();
    anthropic.push({ json: { title: "x" } }, { json: ok });
    await gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed", images: [shot] });
    expect(anthropic.calls[1]!.messages[0]!.images).toHaveLength(1);
    expect(anthropic.calls[1]!.messages.slice(1).every((m) => !m.images)).toBe(true);
  });

  it("applies the same policy: no_ai blocks, local_only goes to the local model", async () => {
    const { gateway, anthropic, local, ledger } = setup();
    await expect(
      gateway.generateObject({ ...baseReq, clientPolicy: "no_ai", images: [shot] }),
    ).rejects.toMatchObject({ code: "policy_blocked" });
    expect(ledger.entries[0]!.inputSummary).toHaveProperty("images");
    local.push({ json: ok });
    await gateway.generateObject({ ...baseReq, clientPolicy: "local_only", images: [shot] });
    expect(anthropic.calls).toHaveLength(0);
    expect(local.calls[0]!.messages[0]!.images).toHaveLength(1);
  });

  it("rejects mismatched, oversized or too many images before any call", async () => {
    const { gateway, anthropic, ledger } = setup();
    const call = (images: Parameters<typeof gateway.generateObject>[0]["images"]) =>
      gateway.generateObject({ ...baseReq, clientPolicy: "external_allowed", images });
    await expect(call([{ ...shot, mimeType: "image/jpeg" }])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(
      call([{ data: new Uint8Array(3_750_001), mimeType: "image/png" }]),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(call(Array.from({ length: 21 }, () => shot))).rejects.toMatchObject({
      code: "validation",
    });
    expect(anthropic.calls).toHaveLength(0);
    expect(ledger.entries).toHaveLength(0);
  });
});
