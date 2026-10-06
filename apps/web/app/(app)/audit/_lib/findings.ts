import "server-only";
import { getProspectBySlug, sourcesById, type FindingRow } from "@forgecy/audit";
import type { Database } from "@forgecy/db";
import { notFound, redirect } from "next/navigation";
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
  return { db, client, audit, readOnly, aiAllowed: client.aiPolicy !== "no_ai" };
}

export function toView(f: FindingRow, currentScanId?: string | null): FindingView {
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
    confidenceReason: f.confidenceReason,
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
  const out: SourceLinks = {};
  for (const [id, s] of rows) {
    out[id] = {
      href: s.kind === "page" ? (s.url ?? null) : await fileUrl(s.storageKey),
      label: s.title ?? s.fileName ?? s.url ?? "Fonte",
    };
  }
  return out;
}
