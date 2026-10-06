import "server-only";
import { getProspectBySlug, sourcesById, type FindingRow } from "@forgecy/audit";
import type { Database } from "@forgecy/db";
import { englishMessage, type MessageKey } from "@forgecy/i18n";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRefText } from "@/lib/i18n";
import type { FindingView, SourceLinks } from "../_components/finding-card";
import { fileUrl, readDeps } from "./server";

/** Prospect and its current audit for a section page; no audit → back to the overview. */
export async function sectionContext(slug: string) {
  const { db } = readDeps();
  const prospect = await getProspectBySlug(db, slug);
  if (!prospect) notFound();
  if (!prospect.audit) redirect(`/audit/${slug}`);
  const { audit, client } = prospect;
  const readOnly = audit.status === "archived" || audit.status === "delivered";
  const rt = await auditRefText();
  return { db, client, audit, readOnly, aiAllowed: client.aiPolicy !== "no_ai", rt };
}

/** Shows a stored reason in the reader's language (see `getRefText`). */
export type RefText = Awaited<ReturnType<typeof getRefText>>;

// Fixed reasons stored before their reference columns existed: recognized by their
// English text and shown in the reader's language; the others stay as written.
const legacy = new Map(
  [
    "skip.robots",
    "skip.redirect",
    "skip.login",
    "skip.timeout",
    "skip.unreachable",
    "unavailable.noWebsite",
    "unavailable.channelSkipped",
    "unavailable.websiteUnreadable",
    "unavailable.auditWithoutCompetitors",
    "crawl.robotsBlocked",
    "crawl.internal",
    "crawl.timeLimit",
    "crawl.stopped",
    "crawl.stoppedByPerson",
    "confidence.noVerified",
    "confidence.sourceRemoved",
    "confidence.noEvidence",
  ].map((k) => {
    const key = `audit.stored.${k}` as MessageKey;
    return [englishMessage(key), { key }] as const;
  }),
);

/** `getRefText` that also recognizes the audit's older stored reasons. */
export async function auditRefText(): Promise<RefText> {
  const rt = await getRefText();
  return (ref, fallback) => rt(ref ?? legacy.get(fallback), fallback);
}

export function toView(f: FindingRow, rt: RefText, currentScanId?: string | null): FindingView {
  return {
    id: f.id,
    kind: f.kind,
    area: f.area,
    title: f.title,
    description: f.description,
    impact: f.impact,
    recommendation: f.recommendation,
    priority: f.priority,
    suggestedPriority: f.suggestedPriority,
    confidence: f.confidence,
    confidenceReason: f.confidenceReason ? rt(f.confidenceRef, f.confidenceReason) : null,
    status: f.status,
    evidence: f.evidence,
    authorAgent: f.authorAgent,
    model: f.aiMeta?.model ?? null,
    rev: f.rev,
    rejectedReason: f.rejectedReason,
    stale: f.stale,
    olderReading: Boolean(currentScanId && f.scanId && f.scanId !== currentScanId),
  };
}

/** Signed links for the sources the findings cite (page screenshots, uploaded files). */
export async function sourceLinks(db: Database, findings: FindingRow[]): Promise<SourceLinks> {
  const ids = [
    ...new Set(findings.flatMap((f) => f.evidence.map((e) => e.sourceId)).filter(Boolean)),
  ] as string[];
  const rows = await sourcesById(db, ids);
  const t = await getTranslations("audit.finding");
  const out: SourceLinks = {};
  for (const [id, s] of rows) {
    out[id] = {
      href: s.kind === "page" ? (s.url ?? null) : await fileUrl(s.storageKey),
      label: s.title ?? s.fileName ?? s.url ?? t("source"),
    };
  }
  return out;
}
