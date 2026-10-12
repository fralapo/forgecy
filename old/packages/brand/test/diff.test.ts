import { describe, expect, it } from "vitest";
import { compareVersions, diffVersions } from "../src/diff";
import { emptyDocument } from "../src/document";
import { defaultTokens, type TokenTree } from "../src/tokens";

const state = () => ({ document: emptyDocument(), tokens: defaultTokens() as TokenTree });

describe("compareVersions", () => {
  it("lists every field once, marking only the ones that differ", () => {
    const left = state();
    const right = state();
    right.document.strategy.oneLiner = {
      id: "o1",
      value: "Invoices that never bounce",
      sourceIds: ["s1"],
      confidence: "high",
    };
    const rows = compareVersions(left, right);
    const pointers = rows.map((r) => r.pointer);
    expect(new Set(pointers).size).toBe(pointers.length);
    const changed = rows.filter((r) => r.changed);
    expect(changed.map((r) => r.pointer)).toEqual(["/document/strategy/oneLiner"]);
    expect(changed[0]).toMatchObject({ left: undefined, right: "Invoices that never bounce" });
    expect(rows.some((r) => r.pointer.startsWith("/tokens/") && !r.changed)).toBe(true);
  });

  it("ignores sources and agrees with the field diff on what changed", () => {
    const left = state();
    const right = state();
    left.document.strategy.oneLiner = {
      id: "o1",
      value: "Same",
      sourceIds: ["a"],
      confidence: "low",
    };
    right.document.strategy.oneLiner = {
      id: "o1",
      value: "Same",
      sourceIds: ["b"],
      confidence: "high",
    };
    expect(compareVersions(left, right).filter((r) => r.changed)).toEqual([]);
    expect(diffVersions(left, right)).toEqual([]);
  });
});

describe("diffVersions: brand fields added for the content factory", () => {
  it("shows the antagonist, words to explain, audience vocabulary and forbidden topics", () => {
    const left = state();
    const right = state();
    right.document.strategy.antagonist = {
      id: "a1",
      value: "The habit of doing it by reflex",
      sourceIds: [],
      confidence: "high",
    };
    right.document.verbal.forbiddenUnlessExplained = ["probiotic"];
    right.document.verbal.audienceVocabulary = ["bucato"];
    right.document.strategy.forbiddenTopics = [
      { topic: "Medical promises", reason: "Not allowed", severity: "error", keywords: ["cura"] },
    ];
    const pointers = diffVersions(left, right).map((c) => c.pointer);
    expect(pointers).toEqual(
      expect.arrayContaining([
        "/document/strategy/antagonist",
        "/document/verbal/forbiddenUnlessExplained",
        "/document/verbal/audienceVocabulary",
        "/document/strategy/forbiddenTopics",
      ]),
    );
    const topics = diffVersions(left, right).find(
      (c) => c.pointer === "/document/strategy/forbiddenTopics",
    );
    expect(topics).toMatchObject({ kind: "changed", before: [], after: ["Medical promises"] });
  });
});
