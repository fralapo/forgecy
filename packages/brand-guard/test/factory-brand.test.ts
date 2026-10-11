import { brandIdentityDocumentSchema } from "@forgecy/brand/document";
import { describe, expect, it } from "vitest";
import { checkContent } from "../src/checks";
import type { GuardContent, GuardTextSlot } from "../src/types";
import { brand, content } from "./fixtures";

const now = new Date("2026-10-11T10:00:00Z");

function withBrand(patch: Record<string, unknown>) {
  const base = brand();
  const doc = brandIdentityDocumentSchema.parse({
    ...base.document,
    strategy: { ...base.document.strategy, ...(patch.strategy as object) },
    verbal: { ...base.document.verbal, ...(patch.verbal as object) },
  });
  return { ...base, document: doc };
}
function withText(text: string): GuardContent {
  const c = content();
  const s = c.slides[1]!.slots.find((x) => x.name === "title") as GuardTextSlot;
  s.text = text;
  s.maxChars = undefined;
  return c;
}
const run = (text: string, b = brand()) =>
  checkContent(withText(text), b, undefined, { now }).findings.map(
    (f) => `${f.check}:${f.severity}`,
  );

describe("brand document additions", () => {
  it("keeps an older document valid with empty defaults", () => {
    const d = brandIdentityDocumentSchema.parse({});
    expect(d.strategy.forbiddenTopics).toEqual([]);
    expect(d.strategy.antagonist).toBeUndefined();
    expect(d.verbal.forbiddenUnlessExplained).toEqual([]);
    expect(d.verbal.audienceVocabulary).toEqual([]);
  });
  it("defaults a forbidden topic to a warning", () => {
    const d = brandIdentityDocumentSchema.parse({
      strategy: { forbiddenTopics: [{ topic: "x" }] },
    });
    expect(d.strategy.forbiddenTopics[0]).toMatchObject({ severity: "warning", keywords: [] });
  });
});

describe("forbidden topics", () => {
  const b = withBrand({
    strategy: {
      forbiddenTopics: [
        {
          topic: "religione",
          reason: "Clienti di ogni fede",
          severity: "error",
          keywords: ["chiesa"],
        },
        { topic: "calcio", severity: "note" },
      ],
    },
  });
  it("reacts per severity, by name or keyword", () => {
    expect(run("Parliamo di religione", b)).toContain("forbidden_topic:error");
    expect(run("Domenica in chiesa", b)).toContain("forbidden_topic:error");
    expect(run("Il calcio di ieri", b)).toContain("forbidden_topic:note");
    expect(run("Un caffè", b).some((x) => x.startsWith("forbidden_topic"))).toBe(false);
  });
});

describe("forbidden unless explained", () => {
  const b = withBrand({ verbal: { forbiddenUnlessExplained: ["crema"] } });
  it("warns on the bare word", () => {
    expect(run("Una crema soffice", b)).toContain("unexplained_word:warning");
  });
  it("accepts the word when the same text explains it", () => {
    expect(run("La crema (cioè l'emulsione)", b)).not.toContain("unexplained_word:warning");
    expect(run("Crema: l'emulsione", b)).not.toContain("unexplained_word:warning");
  });
});
