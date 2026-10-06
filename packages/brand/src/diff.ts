/**
 * Field-level differences between two versions (published vs draft), grouped by
 * block for the approval page. List items are matched by their stable `id`.
 */
import { flattenTokens } from "@forgecy/ui/tokens";
import type { BrandIdentityDocument } from "./document";
import { fields, type BlockKey } from "./fields";
import { deepEqual, getAt } from "./json-patch";
import type { TokenTree } from "./tokens";

export interface FieldChange {
  block: BlockKey;
  label: string;
  pointer: string;
  kind: "added" | "removed" | "changed";
  before: unknown;
  after: unknown;
  sensitive: boolean;
  acceptedFromProposalId?: string;
}

const unwrap = (v: unknown) =>
  typeof v === "object" && v !== null && "value" in v ? (v as { value: unknown }).value : v;
const idOf = (v: unknown) =>
  typeof v === "object" && v !== null && "id" in v
    ? String((v as { id: unknown }).id)
    : JSON.stringify(v);
const proposalOf = (v: unknown) =>
  typeof v === "object" && v !== null && "acceptedFromProposalId" in v
    ? String((v as { acceptedFromProposalId: unknown }).acceptedFromProposalId)
    : undefined;

export function diffVersions(
  before: { document: BrandIdentityDocument; tokens: TokenTree } | null,
  after: { document: BrandIdentityDocument; tokens: TokenTree },
): FieldChange[] {
  const out: FieldChange[] = [];
  const a = before ?? { document: undefined, tokens: {} };
  for (const field of fields) {
    if (field.shape === "token-group") continue;
    const b0 = getAt(a, field.pointer);
    const a0 = getAt(after, field.pointer);
    const base = {
      block: field.block,
      label: field.label,
      pointer: field.pointer,
      sensitive: field.sensitive,
    };
    if (field.shape === "sourced") {
      if (deepEqual(unwrap(b0), unwrap(a0))) continue;
      const pid = proposalOf(a0);
      out.push({
        ...base,
        kind: b0 === undefined ? "added" : a0 === undefined ? "removed" : "changed",
        before: unwrap(b0),
        after: unwrap(a0),
        ...(pid ? { acceptedFromProposalId: pid } : {}),
      });
      continue;
    }
    const before = (b0 as unknown[] | undefined) ?? [];
    const now = (a0 as unknown[] | undefined) ?? [];
    if (field.shape === "string-list") {
      const added = now.filter((x) => !before.includes(x));
      const removed = before.filter((x) => !now.includes(x));
      if (added.length || removed.length)
        out.push({ ...base, kind: "changed", before: removed, after: added });
      continue;
    }
    const byId = new Map(before.map((x) => [idOf(x), x]));
    const seen = new Set<string>();
    for (const item of now) {
      const id = idOf(item);
      seen.add(id);
      const old = byId.get(id);
      if (old !== undefined && deepEqual(unwrap(old), unwrap(item))) continue;
      const pid = proposalOf(item);
      out.push({
        ...base,
        kind: old === undefined ? "added" : "changed",
        before: old === undefined ? undefined : unwrap(old),
        after: unwrap(item),
        ...(pid ? { acceptedFromProposalId: pid } : {}),
      });
    }
    for (const [id, old] of byId)
      if (!seen.has(id))
        out.push({ ...base, kind: "removed", before: unwrap(old), after: undefined });
  }
  out.push(...diffTokens(a.tokens as TokenTree, after.tokens));
  return out;
}

function diffTokens(before: TokenTree, after: TokenTree): FieldChange[] {
  const out: FieldChange[] = [];
  let fb, fa;
  try {
    fb = flattenTokens(before);
    fa = flattenTokens(after);
  } catch {
    return out;
  }
  const sensitive = (p: string) =>
    p.startsWith("color.reference.") || p.startsWith("color.semantic.");
  for (const [path, t] of fa) {
    const old = fb.get(path);
    if (old && deepEqual(old.value, t.value)) continue;
    out.push({
      block: "visual",
      label: `Token ${path}`,
      pointer: `/tokens/${path.split(".").join("/")}`,
      kind: old ? "changed" : "added",
      before: old?.value,
      after: t.value,
      sensitive: sensitive(path),
    });
  }
  for (const [path, t] of fb)
    if (!fa.has(path))
      out.push({
        block: "visual",
        label: `Token ${path}`,
        pointer: `/tokens/${path.split(".").join("/")}`,
        kind: "removed",
        before: t.value,
        after: undefined,
        sensitive: sensitive(path),
      });
  return out;
}

/** One field of the side-by-side comparison: its whole value in each version. */
export interface FieldComparison {
  block: BlockKey;
  label: string;
  pointer: string;
  sensitive: boolean;
  /** Value in the left (older) version; lists keep all their items. */
  left: unknown;
  right: unknown;
  changed: boolean;
}

const plain = (v: unknown): unknown => (Array.isArray(v) ? v.map(unwrap) : unwrap(v));

/**
 * Every field of two versions side by side, in the order of `fields`, then the design
 * tokens present in either version. `changed` uses the same rules as `diffVersions`
 * (sources and proposal ids are not content), so filtering on it shows only what differs.
 */
export function compareVersions(
  left: { document: BrandIdentityDocument; tokens: TokenTree },
  right: { document: BrandIdentityDocument; tokens: TokenTree },
): FieldComparison[] {
  const out: FieldComparison[] = [];
  for (const field of fields) {
    if (field.shape === "token-group") continue;
    const l = plain(getAt(left, field.pointer));
    const r = plain(getAt(right, field.pointer));
    out.push({
      block: field.block,
      label: field.label,
      pointer: field.pointer,
      sensitive: field.sensitive,
      left: l,
      right: r,
      changed: !deepEqual(l ?? null, r ?? null),
    });
  }
  let fl, fr;
  try {
    fl = flattenTokens(left.tokens);
    fr = flattenTokens(right.tokens);
  } catch {
    return out;
  }
  const paths = [...new Set([...fl.keys(), ...fr.keys()])].sort();
  for (const path of paths) {
    const l = fl.get(path)?.value;
    const r = fr.get(path)?.value;
    out.push({
      block: "visual",
      label: `Token ${path}`,
      pointer: `/tokens/${path.split(".").join("/")}`,
      sensitive: path.startsWith("color.reference.") || path.startsWith("color.semantic."),
      left: l,
      right: r,
      changed: !deepEqual(l ?? null, r ?? null),
    });
  }
  return out;
}
