import { describe, expect, it } from "vitest";
import { publishChecks } from "../src/checks";
import { buildBrandContext, type ContextExample } from "../src/context";
import { diffVersions } from "../src/diff";
import { emptyDocument, type BrandIdentityDocument } from "../src/document";
import { defaultTokens } from "../src/tokens";

const sourced = <T>(id: string, value: T) => ({
  id,
  value,
  sourceIds: [],
  confidence: "high" as const,
});

function doc(): BrandIdentityDocument {
  const d = emptyDocument();
  d.strategy.oneLiner = sourced("o1", "Caffè buono per chi lavora");
  d.verbal.forbiddenWords = ["eccellenza"];
  return d;
}

const example = (i: number, verdict: "approved" | "rejected"): ContextExample => ({
  id: `e${i}`,
  kind: "caption",
  verdict,
  body: "y".repeat(700),
  reason: "Concreto",
  channel: null,
  pillarKey: null,
  formatKey: null,
  createdAt: new Date(2026, 0, i),
});

describe("buildBrandContext", () => {
  it("puts identity and binding rules in the stable part and never token values", () => {
    const ctx = buildBrandContext({
      versionId: "v1",
      number: 3,
      document: doc(),
      tokens: defaultTokens(),
    });
    expect(ctx.stable).toContain("# Brand Identity v3");
    expect(ctx.stable).toContain("One-liner: Caffè buono per chi lavora");
    expect(ctx.stable).toContain("Parole vietate (mai usarle): eccellenza");
    expect(ctx.stable).toContain("brand-primary");
    expect(ctx.stable).not.toMatch(/#[0-9a-f]{6}/i);
    expect(ctx.overBudget).toBe(false);
  });

  it("drops the oldest examples first to stay under the cap", () => {
    const examples = [1, 2, 3, 4, 5].map((i) => example(i, "approved"));
    const ctx = buildBrandContext(
      { versionId: "v1", number: 1, document: doc(), tokens: defaultTokens() },
      { examples, maxTokens: 700 },
    );
    expect(ctx.examplesDropped).toBeGreaterThan(0);
    expect(ctx.estimatedTokens).toBeLessThanOrEqual(700);
    expect(ctx.examplesUsed).not.toContain("e1");
    expect(ctx.examplesUsed).toContain("e5");
  });
});

describe("publishChecks and diffVersions", () => {
  it("lists open checks with stable keys", () => {
    const keys = publishChecks(emptyDocument(), defaultTokens(), { conflicts: 2 }).map(
      (c) => c.key,
    );
    expect(keys).toContain("incomplete:one-liner");
    expect(keys).toContain("proposals:conflicts");
    expect(publishChecks(doc(), defaultTokens()).map((c) => c.key)).not.toContain(
      "incomplete:one-liner",
    );
  });

  it("reports added and changed fields", () => {
    const first = diffVersions(null, { document: doc(), tokens: defaultTokens() });
    expect(first.find((c) => c.pointer === "/document/strategy/oneLiner")).toMatchObject({
      kind: "added",
      sensitive: true,
    });
    const next = doc();
    next.strategy.oneLiner = sourced("o1", "Il caffè dell'ufficio");
    const changes = diffVersions(
      { document: doc(), tokens: defaultTokens() },
      { document: next, tokens: defaultTokens() },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "changed",
      before: "Caffè buono per chi lavora",
      after: "Il caffè dell'ufficio",
    });
  });
});
