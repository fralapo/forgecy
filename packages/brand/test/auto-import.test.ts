import { describe, expect, it } from "vitest";
import {
  autoImportStatus,
  changelogFor,
  isHandEdited,
  isSharedDraft,
  overwritesHandEdit,
} from "../src/auto-import";
import { emptyDocument } from "../src/document";
import { matchField } from "../src/fields";
import {
  buildProposalPatch,
  normalizeHumanTokens,
  withEditedValue,
  type DraftState,
} from "../src/proposals";
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

  it("replaces a font token still at the starting value, never one a person set", () => {
    const value = { $value: ["Montserrat", "sans-serif"] };
    expect(overwrites(stateWith(), "/tokens/font/family/display", "set", value)).toBe(false);
    const set = stateWith();
    (set.tokens as { font: { family: Record<string, unknown> } }).font.family.display = {
      $value: ["Georgia", "serif"],
    };
    expect(overwrites(set, "/tokens/font/family/display", "set", value)).toBe(true);
  });
});

describe("autoImportStatus", () => {
  const base = {
    accepted: 0,
    skippedHandEdited: 0,
    needsReview: 0,
    discarded: 0,
    published: false,
  };

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
      needsReview: 2,
      reason: "draft_shared",
    }).map((r) => [r.key, r.values]);
    expect(keys).toEqual([
      ["brand.import.status.autoApplied", { accepted: 3, published: "no" }],
      ["brand.import.status.autoKept", { count: 1 }],
      ["brand.import.status.autoNeedsReview", { count: 2 }],
      ["brand.import.status.autoNotPublished", { reason: "draft_shared" }],
    ]);
  });
});

describe("changelogFor", () => {
  it("keeps only plain characters of the source titles, each and all capped", () => {
    expect(changelogFor(["deodue.test", "instagram deodue"])).toBe(
      "Automatic import from deodue.test, instagram-deodue",
    );
    const hostile = changelogFor(["[click](https://evil.test) <img src=x>", "x".repeat(200)]);
    expect(hostile).not.toMatch(/[[\]()<>:=]/);
    expect(hostile).toContain("from click-https-//evil.test-img-src-x, ");
    expect(hostile.split(", ")[1]).toHaveLength(60);
    expect(changelogFor(Array(20).fill("y".repeat(60))).length).toBe(300);
    expect(changelogFor(["***"])).toBe("Automatic import from public pages");
  });
});

describe("isSharedDraft", () => {
  const me = "u-me";
  it("is the requester's own draft only when nobody else made or changed it", () => {
    expect(isSharedDraft({ status: "draft", createdBy: null, editorIds: [] }, me)).toBe(false);
    expect(isSharedDraft({ status: "draft", createdBy: me, editorIds: [me] }, me)).toBe(false);
    expect(isSharedDraft({ status: "in_review", createdBy: me, editorIds: [me] }, me)).toBe(true);
    expect(isSharedDraft({ status: "draft", createdBy: "u-bo", editorIds: [] }, me)).toBe(true);
    expect(isSharedDraft({ status: "draft", createdBy: null, editorIds: [me, "u-bo"] }, me)).toBe(
      true,
    );
  });
});

describe("provenance of what a person changes", () => {
  const forgecy = { sourceIds: ["s"], confidence: "medium", acceptedFromProposalId: "p" };

  it("drops the import provenance of tokens whose value a person changed, and only those", () => {
    const before = {
      color: {
        reference: {
          kept: { $value: hexToDtcg("#112233"), $extensions: { forgecy } },
          edited: { $value: hexToDtcg("#445566"), $extensions: { forgecy, other: 1 } },
        },
      },
    };
    const after = structuredClone(before);
    after.color.reference.edited.$value = hexToDtcg("#000000");
    const out = normalizeHumanTokens(before, after) as typeof before;
    expect(out.color.reference.kept.$extensions).toEqual({ forgecy });
    expect(out.color.reference.edited.$extensions).toEqual({ other: 1 });
  });

  it("writes an accepted-with-changes value as the person's own", () => {
    const state = stateWith();
    const sourced = buildProposalPatch(
      state,
      { path: "/document/strategy/oneLiner", op: "set", value: "Proposed" },
      meta,
    );
    const item = withEditedValue(sourced.patch, "Corrected", sourced.field).at(-1) as {
      value: Record<string, unknown>;
    };
    expect(item.value).toMatchObject({ value: "Corrected", sourceIds: [], confidence: "high" });
    expect(item.value).not.toHaveProperty("acceptedFromProposalId");
    expect(isHandEdited(item.value as never)).toBe(true);

    const token = buildProposalPatch(
      state,
      { path: "/tokens/color/reference/brand", op: "set", value: { $value: hexToDtcg("#0000FF") } },
      meta,
    );
    const edited = withEditedValue(token.patch, { $value: hexToDtcg("#FF0000") }, token.field);
    expect(JSON.stringify(edited)).not.toContain("forgecy");
  });
});
