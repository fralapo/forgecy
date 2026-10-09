/**
 * Pure proposal logic: turning "set this field to X" into an RFC 6902 patch with
 * `test` ops, computing confidence from the sources, detecting stale proposals
 * and conflicts. The database side lives in service.ts.
 */
import {
  brandSourceKinds,
  type BrandSourceKind,
  type ConfidenceLevel,
  type MessageRef,
} from "@forgecy/core";
import {
  englishMessage,
  localizedError,
  messageRef,
  type MessageKey,
  type MessageValues,
} from "@forgecy/i18n";
import { checkContrast } from "@forgecy/ui/tokens";
import { type BrandIdentityDocument, ONE_LINER_MAX_WORDS, wordCount } from "./document";
import { matchField, type FieldDef } from "./fields";
import { newItemId } from "./ids";
import {
  applyPatch,
  deepEqual,
  formatPointer,
  getAt,
  hasPath,
  JsonPatchError,
  parsePointer,
  type JsonPatch,
} from "./json-patch";
import { normalizeHex, tokenColorHex, type TokenTree } from "./tokens";

export interface DraftState {
  document: BrandIdentityDocument;
  tokens: TokenTree;
}

export interface EvidenceItem {
  sourceId: string;
  /** Page or section, e.g. "p. 12" or "Slide 4". */
  locator?: string;
  quote?: string;
}

export type ProposalOp = "set" | "append" | "remove";

// ---- Confidence (spec table "Provenance and confidence") ----

/** Sources that come straight from the client or the agency's own direct input. */
const DIRECT: ReadonlySet<BrandSourceKind> = new Set([
  "brand_book",
  "document",
  "interview",
  "questionnaire",
  "client_approval",
  "manual",
]);

/**
 * High: a direct client source, or three or more agreeing observed sources.
 * Medium: one or two observed sources. Low: only the agent's own inference, or
 * sources in conflict. The model's self-reported number never enters here.
 */
export function computeConfidence(
  kinds: readonly BrandSourceKind[],
  options: { conflicting?: boolean } = {},
): ConfidenceLevel {
  if (options.conflicting) return "low";
  if (kinds.some((k) => DIRECT.has(k))) return "high";
  const observed = kinds.filter((k) => k !== "agent_observation").length;
  if (observed >= 3) return "high";
  if (observed >= 1) return "medium";
  return "low";
}

export function confidenceReason(
  kinds: readonly BrandSourceKind[],
  options: { conflicting?: boolean } = {},
): string {
  const ref = confidenceReasonRef(kinds, options);
  return englishMessage(ref.key as MessageKey, ref.values);
}

/** The reason for the computed confidence as a message reference (brand.confidenceReason.*). */
export function confidenceReasonRef(
  kinds: readonly BrandSourceKind[],
  options: { conflicting?: boolean } = {},
): MessageRef {
  if (options.conflicting) return messageRef("brand.confidenceReason.conflicting");
  if (kinds.some((k) => DIRECT.has(k))) return messageRef("brand.confidenceReason.direct");
  const observed = kinds.filter((k) => k !== "agent_observation").length;
  if (observed >= 3) return messageRef("brand.confidenceReason.observedMany", { count: observed });
  if (observed === 2) return messageRef("brand.confidenceReason.observedTwo");
  if (observed === 1) return messageRef("brand.confidenceReason.observedOne");
  return messageRef("brand.confidenceReason.aiOnly");
}

/** Lower is stronger: brand book > direct input > site > social > competitor > AI inference. */
export const sourceRank = (kind: BrandSourceKind) => brandSourceKinds.indexOf(kind);

// ---- Building the patch ----

export interface ProposalInput {
  path: string;
  op: ProposalOp;
  /** Raw value (not wrapped in Sourced); omitted for "remove". */
  value?: unknown;
}

export interface BuiltProposal {
  patch: JsonPatch;
  field: FieldDef;
  /** Conflict key: proposals with the same key compete for the same slot. */
  fieldPath: string;
  /** Value written by the final op (wrapped), or undefined for removals. */
  written: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Messages live in packages/i18n (brand.errors.*): the English text stays in err.message.
function invalid(
  key: MessageKey & `brand.errors.${string}`,
  values?: MessageValues,
  details?: Record<string, unknown>,
): never {
  throw localizedError("validation", key, values, details);
}

function parseValue(field: FieldDef, value: unknown): unknown {
  const r = field.value.safeParse(value);
  if (!r.success)
    invalid(
      "brand.errors.invalidValue",
      { field: field.label, detail: r.error.issues[0]?.message ?? "" },
      { issues: r.error.issues.slice(0, 5) },
    );
  return r.data;
}

function index(rest: string, path: string): number {
  const seg = rest.slice(1);
  if (!/^(0|[1-9][0-9]*)$/.test(seg)) invalid("brand.errors.invalidIndex", { path });
  return Number(seg);
}

/**
 * Builds the JSON Patch for one field change. `meta` is merged into the written
 * value: Sourced fields get `sourceIds`, `confidence` and `acceptedFromProposalId`,
 * tokens get `$extensions.forgecy`.
 */
export function buildProposalPatch(
  state: DraftState,
  input: ProposalInput,
  meta: { proposalId: string; sourceIds: string[]; confidence: ConfidenceLevel },
): BuiltProposal {
  const match = matchField(input.path);
  if (!match) invalid("brand.errors.fieldNotProposable", { path: input.path });
  const { field, rest } = match;
  const root: DraftState = { document: state.document, tokens: state.tokens };
  const current = (p: string) => getAt(root, p);
  const test = (p: string) => ({
    op: "test" as const,
    path: p,
    value: structuredClone(current(p)),
  });
  const wrap = (raw: unknown, id?: string) => ({
    id: id ?? newItemId(),
    value: raw,
    sourceIds: meta.sourceIds,
    confidence: meta.confidence,
    acceptedFromProposalId: meta.proposalId,
  });

  switch (field.shape) {
    case "sourced": {
      if (rest !== "") invalid("brand.errors.singleValue", { field: field.label });
      if (input.op === "append") invalid("brand.errors.notAList", { field: field.label });
      if (input.op === "remove") {
        if (!hasPath(root, field.pointer))
          invalid("brand.errors.alreadyEmpty", { field: field.label });
        return {
          patch: [test(field.pointer), { op: "remove", path: field.pointer }],
          field,
          fieldPath: field.pointer,
          written: undefined,
        };
      }
      const old = current(field.pointer) as { id?: string } | undefined;
      const written = wrap(parseValue(field, input.value), old?.id);
      const patch: JsonPatch = old
        ? [test(field.pointer), { op: "replace", path: field.pointer, value: written }]
        : [{ op: "add", path: field.pointer, value: written }];
      return { patch, field, fieldPath: field.pointer, written };
    }
    case "sourced-list":
    case "object-list":
    case "string-list": {
      const items = (current(field.pointer) as unknown[] | undefined) ?? [];
      const plain = field.shape === "string-list";
      const itemValue = (it: unknown) =>
        field.shape === "sourced-list" ? (it as { value: unknown }).value : it;
      if (input.op === "append") {
        if (rest !== "" && rest !== "/-")
          invalid("brand.errors.useAppend", { pointer: field.pointer });
        // Items of an object list carry an id the proposer cannot know (logo variants require it).
        const given =
          field.shape === "object-list" && isObject(input.value) && !input.value.id
            ? { ...input.value, id: newItemId() }
            : input.value;
        const raw = parseValue(field, given);
        const key = field.uniqueBy?.(raw);
        const existing = key
          ? items.findIndex((it) => field.uniqueBy?.(itemValue(it)) === key)
          : -1;
        if (existing >= 0) {
          if (plain) invalid("brand.errors.alreadyIn", { value: String(raw), field: field.label });
          const p = `${field.pointer}/${existing}`;
          const old = items[existing] as Record<string, unknown>;
          const written =
            field.shape === "sourced-list"
              ? wrap(raw, old.id as string)
              : { ...(raw as Record<string, unknown>), id: old.id };
          return {
            patch: [test(p), { op: "replace", path: p, value: written }],
            field,
            fieldPath: `${field.pointer}[${key}]`,
            written,
          };
        }
        const written = field.shape === "sourced-list" ? wrap(raw) : raw;
        return {
          patch: [{ op: "add", path: `${field.pointer}/-`, value: written }],
          field,
          fieldPath: key ? `${field.pointer}[${key}]` : `${field.pointer}/-`,
          written,
        };
      }
      const i = index(rest, input.path);
      const p = `${field.pointer}/${i}`;
      if (i >= items.length) invalid("brand.errors.itemMissing", { index: i, field: field.label });
      if (input.op === "remove")
        return {
          patch: [test(p), { op: "remove", path: p }],
          field,
          fieldPath: p,
          written: undefined,
        };
      const raw = parseValue(field, input.value);
      const old = items[i] as Record<string, unknown>;
      const written =
        field.shape === "sourced-list"
          ? wrap(raw, old.id as string)
          : field.shape === "object-list"
            ? { ...(raw as Record<string, unknown>), id: old.id }
            : raw;
      return {
        patch: [test(p), { op: "replace", path: p, value: written }],
        field,
        fieldPath: p,
        written,
      };
    }
    case "token-group": {
      if (input.op === "append") invalid("brand.errors.tokenUseSet");
      if (rest === "" || rest === "/-") invalid("brand.errors.tokenNameMissing");
      const segs = parsePointer(rest);
      if (segs.some((s) => !/^[a-z0-9][a-z0-9-]{0,40}$/.test(s)))
        invalid("brand.errors.tokenNameInvalid");
      const p = input.path;
      if (input.op === "remove") {
        if (!hasPath(root, p)) invalid("brand.errors.tokenMissing");
        return {
          patch: [test(p), { op: "remove", path: p }],
          field,
          fieldPath: p,
          written: undefined,
        };
      }
      const raw = parseValue(field, input.value) as Record<string, unknown>;
      const written = {
        ...raw,
        $extensions: {
          ...(isObject(raw.$extensions) ? raw.$extensions : {}),
          forgecy: {
            sourceIds: meta.sourceIds,
            confidence: meta.confidence,
            acceptedFromProposalId: meta.proposalId,
          },
        },
      };
      if (hasPath(root, p))
        return {
          patch: [test(p), { op: "replace", path: p, value: written }],
          field,
          fieldPath: p,
          written,
        };
      // Create missing groups along the way with a single add on the first missing segment.
      const all = parsePointer(p);
      let k = 1;
      while (k < all.length && hasPath(root, formatPointer(all.slice(0, k)))) k++;
      const addAt = formatPointer(all.slice(0, k));
      let value: unknown = written;
      for (let j = all.length - 1; j >= k; j--) value = { [all[j]!]: value };
      return { patch: [{ op: "add", path: addAt, value }], field, fieldPath: p, written };
    }
  }
}

// ---- Applying ----

/**
 * Applies a proposal patch. Stricter than RFC 6902 on purpose: an `add` on an
 * object member that already exists counts as a failed test, because someone
 * filled that field after the proposal was made.
 */
export function applyProposalPatch(state: DraftState, patch: JsonPatch): DraftState {
  for (const op of patch) {
    if (op.op !== "add") continue;
    const segs = parsePointer(op.path);
    const last = segs.at(-1);
    const parent = getAt(state, formatPointer(segs.slice(0, -1)));
    if (isObject(parent) && last !== undefined && Object.hasOwn(parent, last))
      throw new JsonPatchError("test_failed", op.path, `Value at ${op.path} was set meanwhile`);
  }
  return applyPatch(state, patch);
}

/** True when the patch still applies to the draft. */
export function stillApplies(state: DraftState, patch: JsonPatch): boolean {
  try {
    applyProposalPatch(state, patch);
    return true;
  } catch (err) {
    if (err instanceof JsonPatchError) return false;
    throw err;
  }
}

/** Replaces the value of the last write op (used by "Accept with changes"). */
export function withEditedValue(patch: JsonPatch, edited: unknown, field: FieldDef): JsonPatch {
  const raw = parseValue(field, edited);
  const out = structuredClone(patch);
  const last = out.at(-1);
  if (!last || (last.op !== "add" && last.op !== "replace")) invalid("brand.errors.nothingToEdit");
  const v = last.value;
  if (field.shape === "sourced" || field.shape === "sourced-list") {
    (v as { value: unknown }).value = raw;
  } else if (field.shape === "token-group") {
    const ext = (v as Record<string, unknown>).$extensions;
    last.value = { ...(raw as Record<string, unknown>), $extensions: ext };
  } else if (field.shape === "object-list") {
    last.value = { ...(raw as Record<string, unknown>), id: (v as { id?: unknown }).id };
  } else last.value = raw;
  return out;
}

/** The raw (unwrapped) value a patch writes, for display and conflict comparison. */
export function proposedValue(patch: JsonPatch, field: FieldDef): unknown {
  const last = patch.at(-1);
  if (!last || (last.op !== "add" && last.op !== "replace")) return undefined;
  let v = last.value;
  // Token adds may wrap the token in missing groups.
  if (field.shape === "token-group") {
    while (isObject(v) && !("$value" in v) && Object.keys(v).length === 1) v = Object.values(v)[0];
    const { $extensions: _ext, ...rest } = v as Record<string, unknown>;
    return rest;
  }
  if (field.shape === "sourced" || field.shape === "sourced-list")
    return (v as { value: unknown }).value;
  if (field.shape === "object-list" && isObject(v)) {
    const { id: _id, ...rest } = v;
    return rest;
  }
  return v;
}

/** Current raw value of the slot a proposal targets, for the side-by-side diff. */
export function currentValue(state: DraftState, patch: JsonPatch, field: FieldDef): unknown {
  const target = patch.find((op) => op.op === "test") ?? patch.at(-1);
  if (!target) return undefined;
  const v = getAt(state, target.path);
  if (v === undefined) return undefined;
  if (field.shape === "sourced" || field.shape === "sourced-list")
    return (v as { value?: unknown }).value;
  if (field.shape === "token-group" && isObject(v)) {
    const { $extensions: _ext, ...rest } = v;
    return rest;
  }
  return v;
}

// ---- Conflicts ----

export interface PendingLike {
  id: string;
  fieldPath: string;
  changes: JsonPatch;
  evidenceKinds: BrandSourceKind[];
}

export interface ConflictGroup {
  fieldPath: string;
  proposalIds: string[];
  /** Proposal the source hierarchy suggests; a person still decides. */
  suggestedId: string;
}

/** Pending proposals on the same slot with different values. */
export function findConflicts(pending: readonly PendingLike[]): ConflictGroup[] {
  const groups = new Map<string, PendingLike[]>();
  for (const p of pending) {
    if (p.fieldPath.endsWith("/-")) continue;
    const g = groups.get(p.fieldPath) ?? [];
    g.push(p);
    groups.set(p.fieldPath, g);
  }
  const out: ConflictGroup[] = [];
  for (const [fieldPath, list] of groups) {
    if (list.length < 2) continue;
    const match = matchField(fieldPath.replace(/\[.*\]$/, ""));
    const values = list.map((p) => (match ? proposedValue(p.changes, match.field) : p.changes));
    if (values.every((v) => deepEqual(v, values[0]))) continue;
    const best = (p: PendingLike) =>
      Math.min(...p.evidenceKinds.map(sourceRank), brandSourceKinds.length);
    const suggested = [...list].sort((a, b) => best(a) - best(b))[0]!;
    out.push({ fieldPath, proposalIds: list.map((p) => p.id), suggestedId: suggested.id });
  }
  return out;
}

// ---- Automatic checks stored on the proposal (an outcome, not a review) ----

export interface ProposalCheck {
  level: "info" | "warning";
  /** English text, also the fallback for checks stored before `ref` existed. */
  message: string;
  /** The same text as a message reference, translated when shown. */
  ref?: MessageRef;
}

const check = (
  level: ProposalCheck["level"],
  key: MessageKey & `brand.proposalChecks.${string}`,
  values?: MessageValues,
): ProposalCheck => ({
  level,
  message: englishMessage(key, values),
  ref: messageRef(key, values),
});

function textsOf(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(textsOf);
  if (isObject(v)) return Object.values(v).flatMap(textsOf);
  return [];
}

export function checksFor(state: DraftState, field: FieldDef, value: unknown): ProposalCheck[] {
  const checks: ProposalCheck[] = [];
  if (value === undefined) return checks;
  const forbidden = state.document.verbal.forbiddenWords.map((w) => w.toLowerCase());
  if (field.pointer.startsWith("/document/") && forbidden.length) {
    const hay = textsOf(value).join(" ").toLowerCase();
    for (const w of forbidden)
      if (
        new RegExp(
          `(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`,
          "u",
        ).test(hay)
      )
        checks.push(check("warning", "brand.proposalChecks.forbiddenWord", { word: w }));
  }
  if (field.pointer === "/document/strategy/oneLiner" && typeof value === "string") {
    const n = wordCount(value);
    if (n > ONE_LINER_MAX_WORDS)
      checks.push(
        check("warning", "brand.proposalChecks.oneLinerLength", {
          count: n,
          max: ONE_LINER_MAX_WORDS,
        }),
      );
  }
  if (field.pointer === "/tokens/color/reference" && isObject(value)) {
    const v = value.$value as { hex?: string } | string | undefined;
    const hex = normalizeHex(typeof v === "string" ? v : (v?.hex ?? ""));
    const bg = tokenColorHex(state.tokens, "color.semantic.background");
    if (hex && bg) {
      const ratio = checkContrast(hex, bg);
      checks.push(
        check(ratio < 3 ? "warning" : "info", "brand.proposalChecks.contrast", {
          ratio: ratio.toFixed(1),
          grade: ratio >= 4.5 ? "normal" : ratio >= 3 ? "large" : "fail",
        }),
      );
    }
  }
  if (!checks.length) checks.push(check("info", "brand.proposalChecks.noIssues"));
  return checks;
}
