import { describe, expect, it } from "vitest";
import { autoImportStatus, isHandEdited, overwritesHandEdit } from "../src/auto-import";
import { emptyDocument } from "../src/document";
import { matchField } from "../src/fields";
import { buildProposalPatch, type DraftState } from "../src/proposals";
import { defaultTokens, hexToDtcg } from "../src/tokens";

const meta = { proposalId: "p-new", sourceIds: ["s-site"], confidence: "medium" as const };

function stateWith(
  oneLiner?: Record<string, unknown>,
  tokens: Record<string, unknown> = {},
): DraftState {
  const document = emptyDocument();
  if (oneLiner) (document.strategy as Record<string, unknown>).oneLiner = oneLiner;
  const t = defaultTokens() as { color: { reference: Record<string, unknown> } };
  Object.assign(t.color.reference, tokens);
  return { document, tokens: t as DraftState["tokens"] };
}

const overwrites = (state: DraftState, path: string, op: "set" | "append", value: unknown) =>
  overwritesHandEdit(
    state,
    buildProposalPatch(state, { path, op, value }, meta).patch,
    matchField(path)!.field,
  );

describe("isHandEdited", () => {
  it("is true for a value typed by a person (no source)", () => {
    expect(isHandEdited({ sourceIds: [], confidence: "high" })).toBe(true);
    expect(isHandEdited({ sourceIds: [], confidence: "low", acceptedFromProposalId: "p" })).toBe(
      true,
    );
  });

  it("is true for a high-confidence value that did not come from a proposal", () => {
    expect(isHandEdited({ sourceIds: ["s"], confidence: "high" })).toBe(true);
  });

  it("is false for values accepted from a proposal or observed with lower confidence", () => {
    expect(
      isHandEdited({ sourceIds: ["s"], confidence: "high", acceptedFromProposalId: "p" }),
    ).toBe(false);
    expect(isHandEdited({ sourceIds: ["s"], confidence: "medium" })).toBe(false);
  });
});

describe("overwritesHandEdit", () => {
  const hand = { id: "o1", value: "Typed by Anna", sourceIds: [], confidence: "high" };
  const imported = {
    id: "o1",
    value: "From the site",
    sourceIds: ["s-old"],
    confidence: "medium",
    acceptedFromProposalId: "p-old",
  };

  it("keeps a scalar a person wrote, and replaces one a previous import wrote", () => {
    expect(overwrites(stateWith(hand), "/document/strategy/oneLiner", "set", "New")).toBe(true);
    expect(overwrites(stateWith(imported), "/document/strategy/oneLiner", "set", "New")).toBe(
      false,
    );
  });

  it("fills an empty field and appends to a list freely", () => {
    expect(overwrites(stateWith(), "/document/strategy/oneLiner", "set", "New")).toBe(false);
    expect(overwrites(stateWith(), "/document/strategy/values", "append", { name: "Family" })).toBe(
      false,
    );
  });

  it("keeps a list item a person wrote when an import names the same item", () => {
    const state = stateWith();
    state.document.strategy.values = [
      { id: "v1", value: { name: "Family" }, sourceIds: [], confidence: "high" },
    ];
    expect(
      overwrites(state, "/document/strategy/values", "append", {
        name: "family",
        description: "Since 1998",
      }),
    ).toBe(true);
  });

  it("treats a token with no import provenance as hand-made, and an imported one as replaceable", () => {
    const value = { $value: hexToDtcg("#0000FF") };
    const handMade = stateWith(undefined, { brand: { ...value } });
    expect(overwrites(handMade, "/tokens/color/reference/brand", "set", value)).toBe(true);
    const fromImport = stateWith(undefined, {
      brand: {
        ...value,
        $extensions: {
          forgecy: { sourceIds: ["s"], confidence: "medium", acceptedFromProposalId: "p" },
        },
      },
    });
    expect(overwrites(fromImport, "/tokens/color/reference/brand", "set", value)).toBe(false);
    expect(overwrites(handMade, "/tokens/color/reference/new-one", "set", value)).toBe(false);
  });
});

describe("autoImportStatus", () => {
  const base = { accepted: 0, skippedHandEdited: 0, discarded: 0, published: false };

  it("says why nothing was applied, and nothing else", () => {
    expect(autoImportStatus({ ...base, reason: "no_access" })).toEqual([
      { key: "brand.import.status.autoNotApplied", values: { reason: "no_access" } },
    ]);
  });

  it("counts applied and kept items and says when the draft was not published", () => {
    const keys = autoImportStatus({
      ...base,
      accepted: 3,
      skippedHandEdited: 1,
      reason: "not_publishable",
    }).map((r) => [r.key, r.values]);
    expect(keys).toEqual([
      ["brand.import.status.autoApplied", { accepted: 3, published: "no" }],
      ["brand.import.status.autoKept", { count: 1 }],
      ["brand.import.status.autoNotPublished", undefined],
    ]);
  });
});
