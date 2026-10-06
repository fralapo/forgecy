import {
  confidenceFromEvidence,
  type AuditChannel,
  type AuditEvidence,
  type EvidenceType,
  type Level,
} from "@forgecy/core";
import { quoteFound } from "./agents";

/** What a reference id given to the model (P1, CHECK:h1, POST:12, O3…) points at. */
export interface RefTarget {
  type: Exclude<EvidenceType, "quote">;
  label: string;
  sourceId?: string;
  url?: string;
  /** Text a quote must be found in (verbatim). */
  text?: string;
  channel?: AuditChannel;
  capturedAt?: string;
  /** Finding behind an O ref (diagnosis, comparison). */
  findingId?: string;
  /** Groups refs that count as one element (e.g. one company in a benchmark). */
  group?: string;
}

export type RefIndex = Map<string, RefTarget>;

export const normalizeRef = (ref: string) => ref.trim().toUpperCase().replace(/\s+/g, "");

export function buildIndex(entries: Array<[string, RefTarget]>): RefIndex {
  return new Map(entries.map(([k, v]) => [normalizeRef(k), v]));
}

export interface VerifiedEvidence {
  evidence: AuditEvidence[];
  /** Distinct elements (pages, checks, posts, metrics) backing the claim. */
  distinct: number;
  labels: string[];
  /** Refs that pointed at nothing and were dropped. */
  dropped: string[];
  /** Findings behind O refs, in order. */
  findingIds: string[];
  targets: RefTarget[];
}

/**
 * Keep only evidence that points at real data. Quotes must appear verbatim in the
 * referenced source; a quote that does not is removed (the page stays as evidence).
 */
export function verifyEvidence(
  items: Array<{ ref: string; quote?: string | undefined; label?: string | undefined }>,
  index: RefIndex,
): VerifiedEvidence {
  const evidence: AuditEvidence[] = [];
  const seen = new Set<string>();
  const labels: string[] = [];
  const dropped: string[] = [];
  const findingIds: string[] = [];
  const targets: RefTarget[] = [];
  for (const item of items) {
    const key = normalizeRef(item.ref);
    const target = index.get(key);
    if (!target) {
      dropped.push(item.ref);
      continue;
    }
    const quote = item.quote?.trim();
    const verifiedQuote =
      quote && target.text && quoteFound(quote, target.text) ? quote : undefined;
    const dedupe = `${key}|${verifiedQuote ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    targets.push(target);
    if (target.findingId && !findingIds.includes(target.findingId))
      findingIds.push(target.findingId);
    evidence.push({
      type: verifiedQuote ? "quote" : target.type,
      label: (item.label?.trim() || target.label).slice(0, 120),
      ...(target.sourceId ? { sourceId: target.sourceId } : {}),
      ...(target.url ? { url: target.url } : {}),
      ...(verifiedQuote ? { quote: verifiedQuote.slice(0, 200) } : {}),
      ...(target.channel ? { channel: target.channel } : {}),
      ...(target.capturedAt ? { capturedAt: target.capturedAt } : {}),
    });
  }
  const groups = new Set(
    targets.map((t) => t.group ?? t.findingId ?? t.sourceId ?? `${t.type}:${t.label}`),
  );
  for (const t of targets) if (!labels.includes(t.label)) labels.push(t.label);
  return { evidence, distinct: groups.size, labels, dropped, findingIds, targets };
}

/** Confidence and its reason, computed from verified evidence only. */
export function confidenceOf(v: Pick<VerifiedEvidence, "distinct" | "labels">): {
  confidence: Level;
  reason: string;
} {
  const confidence = confidenceFromEvidence(v.distinct);
  const what = v.labels.slice(0, 4).join(", ");
  const reason =
    v.distinct >= 3
      ? `${v.distinct} elementi concordanti: ${what}`
      : v.distinct === 2
        ? `2 elementi: ${what}`
        : `Un solo elemento: ${what}`;
  return { confidence, reason };
}
