import { describe, expect, it } from "vitest";
import { emptyDocument } from "../src/document";
import { fieldLabel, isSensitivePath, matchField } from "../src/fields";
import {
  applyProposalPatch,
  buildProposalPatch,
  checksFor,
  computeConfidence,
  confidenceReason,
  currentValue,
  findConflicts,
  proposedValue,
  stillApplies,
  withEditedValue,
  type DraftState,
} from "../src/proposals";
import { defaultTokens, hexToDtcg } from "../src/tokens";

const meta = { proposalId: "p1", sourceIds: ["s1"], confidence: "high" as const };
const fresh = (): DraftState => ({ document: emptyDocument(), tokens: defaultTokens() });

describe("confidence from sources", () => {
  it("follows the spec table", () => {
    expect(computeConfidence(["brand_book"])).toBe("high");
    expect(computeConfidence(["website", "instagram", "facebook"])).toBe("high");
    expect(computeConfidence(["website", "instagram"])).toBe("medium");
    expect(computeConfidence(["website"])).toBe("medium");
    expect(computeConfidence(["agent_observation"])).toBe("low");
    expect(computeConfidence([])).toBe("low");
    expect(computeConfidence(["brand_book"], { conflicting: true })).toBe("low");
    expect(confidenceReason(["website", "instagram"])).toBe("Two observed sources");
    expect(confidenceReason(["agent_observation"])).toBe("AI inference only");
  });
});

describe("fields", () => {
  it("knows sensitive categories", () => {
    expect(isSensitivePath("/document/strategy/positioning")).toBe(true);
    expect(isSensitivePath("/document/verbal/toneAxes/2")).toBe(true);
    expect(isSensitivePath("/tokens/color/reference/blue")).toBe(true);
    expect(isSensitivePath("/document/verbal/forbiddenWords/-")).toBe(false);
    expect(fieldLabel("/document/verbal/toneAxes")).toBe("Verbal › Tone axes");
    expect(matchField("/document/nope")).toBeNull();
  });
});

describe("buildProposalPatch", () => {
  it("adds a missing single value and replaces an existing one with a test op", () => {
    const s = fresh();
    const add = buildProposalPatch(
      s,
      { path: "/document/strategy/oneLiner", op: "set", value: "Coffee for people who work" },
      meta,
    );
    expect(add.patch).toHaveLength(1);
    expect(add.patch[0]).toMatchObject({ op: "add", path: "/document/strategy/oneLiner" });
    const after = applyProposalPatch(s, add.patch);
    expect(after.document.strategy.oneLiner).toMatchObject({
      value: "Coffee for people who work",
      sourceIds: ["s1"],
      confidence: "high",
      acceptedFromProposalId: "p1",
    });
    const rep = buildProposalPatch(
      after,
      { path: "/document/strategy/oneLiner", op: "set", value: "Other" },
      { ...meta, proposalId: "p2" },
    );
    expect(rep.patch.map((o) => o.op)).toEqual(["test", "replace"]);
    // keeps the item id across replacements
    expect((rep.written as { id: string }).id).toBe(after.document.strategy.oneLiner!.id);
  });

  it("goes stale when the field changed after the proposal", () => {
    const s = applyProposalPatch(
      fresh(),
      buildProposalPatch(
        fresh(),
        { path: "/document/strategy/promise", op: "set", value: "A" },
        meta,
      ).patch,
    );
    const p = buildProposalPatch(
      s,
      { path: "/document/strategy/promise", op: "set", value: "B" },
      meta,
    );
    const changed = structuredClone(s);
    changed.document.strategy.promise!.value = "C";
    expect(stillApplies(s, p.patch)).toBe(true);
    expect(stillApplies(changed, p.patch)).toBe(false);
  });

  it("treats an add on a member filled meanwhile as stale", () => {
    const s = fresh();
    const p = buildProposalPatch(
      s,
      { path: "/document/strategy/insight", op: "set", value: "X" },
      meta,
    );
    const filled = applyProposalPatch(
      s,
      buildProposalPatch(s, { path: "/document/strategy/insight", op: "set", value: "Y" }, meta)
        .patch,
    );
    expect(stillApplies(filled, p.patch)).toBe(false);
  });

  it("appends list items and replaces items with the same key", () => {
    const s = fresh();
    const axis = {
      axis: "formal",
      value: 2,
      goodExample: "Hi, here’s how",
      badExample: "Dear Sir",
    };
    const a = buildProposalPatch(
      s,
      { path: "/document/verbal/toneAxes", op: "append", value: axis },
      meta,
    );
    expect(a.patch[0]).toMatchObject({ op: "add", path: "/document/verbal/toneAxes/-" });
    expect(a.fieldPath).toBe("/document/verbal/toneAxes[formal]");
    const s2 = applyProposalPatch(s, a.patch);
    const b = buildProposalPatch(
      s2,
      { path: "/document/verbal/toneAxes", op: "append", value: { ...axis, value: 4 } },
      meta,
    );
    expect(b.patch.map((o) => o.path)).toEqual([
      "/document/verbal/toneAxes/0",
      "/document/verbal/toneAxes/0",
    ]);
    expect(applyProposalPatch(s2, b.patch).document.verbal.toneAxes).toHaveLength(1);
  });

  it("requires examples on tone axes (an adjective alone does not pass)", () => {
    expect(() =>
      buildProposalPatch(
        fresh(),
        { path: "/document/verbal/toneAxes", op: "append", value: { axis: "formal", value: 2 } },
        meta,
      ),
    ).toThrow(/Invalid value/);
  });

  it("refuses duplicate words", () => {
    const s = fresh();
    s.document.verbal.forbiddenWords = ["free"];
    expect(() =>
      buildProposalPatch(
        s,
        { path: "/document/verbal/forbiddenWords", op: "append", value: "Free" },
        meta,
      ),
    ).toThrow(/already in/);
  });

  it("proposes tokens with provenance in $extensions.forgecy, creating missing groups", () => {
    const s = fresh();
    const p = buildProposalPatch(
      s,
      {
        path: "/tokens/color/reference/rossi-blue",
        op: "set",
        value: { $value: hexToDtcg("#0044CC") },
      },
      meta,
    );
    const out = applyProposalPatch(s, p.patch);
    const tok = (out.tokens.color as { reference: Record<string, { $extensions: unknown }> })
      .reference["rossi-blue"];
    expect(tok?.$extensions).toEqual({
      forgecy: { sourceIds: ["s1"], confidence: "high", acceptedFromProposalId: "p1" },
    });
    expect(proposedValue(p.patch, p.field)).toEqual({ $value: hexToDtcg("#0044CC") });
    const deep = buildProposalPatch(
      s,
      {
        path: "/tokens/component/badge/background",
        op: "set",
        value: { $value: "{color.semantic.accent}" },
      },
      meta,
    );
    expect(deep.patch[0]).toMatchObject({ op: "add", path: "/tokens/component/badge" });
  });

  it("supports accept with edits and reads current/proposed values", () => {
    const s = fresh();
    const p = buildProposalPatch(
      s,
      { path: "/document/strategy/vision", op: "set", value: "Before" },
      meta,
    );
    const edited = withEditedValue(p.patch, "After", p.field);
    expect(proposedValue(edited, p.field)).toBe("After");
    expect(currentValue(s, p.patch, p.field)).toBeUndefined();
  });
});

describe("conflicts", () => {
  it("groups pending proposals on the same slot with different values and suggests by hierarchy", () => {
    const s = fresh();
    const a = buildProposalPatch(
      s,
      {
        path: "/tokens/color/reference/primary",
        op: "set",
        value: { $value: hexToDtcg("#0044CC") },
      },
      meta,
    );
    const b = buildProposalPatch(
      s,
      {
        path: "/tokens/color/reference/primary",
        op: "set",
        value: { $value: hexToDtcg("#1155DD") },
      },
      meta,
    );
    const c = buildProposalPatch(
      s,
      { path: "/document/verbal/forbiddenWords", op: "append", value: "low cost" },
      meta,
    );
    const groups = findConflicts([
      { id: "site", fieldPath: a.fieldPath, changes: a.patch, evidenceKinds: ["website"] },
      { id: "book", fieldPath: b.fieldPath, changes: b.patch, evidenceKinds: ["brand_book"] },
      { id: "w", fieldPath: c.fieldPath, changes: c.patch, evidenceKinds: [] },
    ]);
    expect(groups).toEqual([
      {
        fieldPath: "/tokens/color/reference/primary",
        proposalIds: ["site", "book"],
        suggestedId: "book",
      },
    ]);
  });
});

describe("automatic checks", () => {
  it("flags forbidden words, long one-liners and low contrast", () => {
    const s = fresh();
    s.document.verbal.forbiddenWords = ["free"];
    const f = matchField("/document/strategy/oneLiner")!.field;
    const long =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone free";
    const msgs = checksFor(s, f, long).map((c) => c.message);
    expect(msgs).toContain('Forbidden word: "free"');
    expect(msgs.some((m) => m.startsWith("One-liner of 22 words"))).toBe(true);
    const tf = matchField("/tokens/color/reference/yellow")!.field;
    expect(checksFor(s, tf, { $value: hexToDtcg("#FFE600") })[0]).toMatchObject({
      level: "warning",
    });
  });
});
