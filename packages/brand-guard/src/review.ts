/**
 * Brand Guard in the review flow (spec Page 46 and 47): findings signal, they do not
 * block sending to review. A person may ignore a warning or a note for this content
 * with a reason; errors are never ignored, they are fixed or confirmed with “I’ve seen it”.
 * The approver confirms every open error and warning; the only findings that block
 * approval are AI images not approved by a person.
 */
import type { BrandCheckIgnoreReason, BrandCheckIssueStatus } from "@forgecy/core";
import { countBySeverity } from "./checks";
import { coherenceScore } from "./score";
import type { BrandCheckFinding, BrandCheckReport } from "./types";

export interface IssueState {
  findingKey: string;
  blockHash: string;
  status: BrandCheckIssueStatus;
  reason?: BrandCheckIgnoreReason | null;
  note?: string | null;
  /** “I’ve seen it” is per content version; ignores hold across versions (null). */
  subjectVersion: number | null;
  userId: string;
  createdAt: Date | string;
}

export const IGNORE_REASON_LABELS: Record<BrandCheckIgnoreReason, string> = {
  client_request: "Requested by the client",
  creative_choice: "Deliberate creative choice",
  false_positive: "False positive",
  other: "Other",
};

export interface ReviewedFinding extends BrandCheckFinding {
  status: "open" | "ignored";
  ignored?: { by: string; reason: BrandCheckIgnoreReason; note?: string; at: string };
  acknowledged?: { by: string; at: string };
}

export interface ReviewedReport extends Omit<BrandCheckReport, "findings"> {
  findings: ReviewedFinding[];
  /** Open findings only (what the summary cards show as "open"). */
  open: BrandCheckReport["counts"];
  ignoredCount: BrandCheckReport["counts"];
  /** Findings of the previous run that are gone ("Resolved by the 14:40 edit"). */
  resolved: BrandCheckFinding[];
}

export const canIgnore = (f: Pick<BrandCheckFinding, "severity">) => f.severity !== "error";

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());

/**
 * Merges what people decided into a report. An ignore holds while the block is
 * unchanged (same `blockHash`); when the block changes the finding reopens. A
 * “I’ve seen it” counts only for the content version it was given on.
 */
export function applyIssueStates(
  report: BrandCheckReport,
  states: readonly IssueState[],
  options: { subjectVersion?: number | null; previous?: BrandCheckReport | null } = {},
): ReviewedReport {
  const version = options.subjectVersion ?? null;
  const findings = report.findings.map((f): ReviewedFinding => {
    const mine = states.filter((s) => s.findingKey === f.key && s.blockHash === f.blockHash);
    const ignore = canIgnore(f) ? mine.find((s) => s.status === "ignored" && s.reason) : undefined;
    const ack = mine.find((s) => s.status === "acknowledged" && s.subjectVersion === version);
    const reviewed: ReviewedFinding = { ...f, status: ignore ? "ignored" : "open" };
    if (ignore)
      reviewed.ignored = {
        by: ignore.userId,
        reason: ignore.reason!,
        ...(ignore.note ? { note: ignore.note } : {}),
        at: iso(ignore.createdAt),
      };
    if (ack) reviewed.acknowledged = { by: ack.userId, at: iso(ack.createdAt) };
    return reviewed;
  });
  const open = findings.filter((f) => f.status === "open");
  const current = new Set(findings.map((f) => f.key));
  return {
    ...report,
    findings,
    open: countBySeverity(open),
    ignoredCount: countBySeverity(findings.filter((f) => f.status === "ignored")),
    coherence: coherenceScore(open),
    resolved: (options.previous?.findings ?? []).filter((f) => !current.has(f.key)),
  };
}

export interface ApprovalGate {
  /** True when nothing blocks approval and every open error and warning has “I’ve seen it”. */
  ready: boolean;
  /** Unapproved or rejected AI images: approval stays blocked until they change. */
  blockers: ReviewedFinding[];
  /** Open errors and warnings still waiting for “I’ve seen it” on this version. */
  toAcknowledge: ReviewedFinding[];
}

/**
 * What the approval dialog needs. `acknowledgedKeys` are the “I’ve seen it” ticked in the
 * dialog being submitted, on top of those already stored for this version.
 */
export function approvalGate(
  reviewed: ReviewedReport,
  acknowledgedKeys: readonly string[] = [],
): ApprovalGate {
  const acked = new Set(acknowledgedKeys);
  const open = reviewed.findings.filter((f) => f.status === "open");
  const blockers = open.filter((f) => f.blocksApproval);
  const toAcknowledge = open.filter(
    (f) =>
      !f.blocksApproval &&
      (f.severity === "error" || f.severity === "warning") &&
      !f.acknowledged &&
      !acked.has(f.key),
  );
  return { ready: !blockers.length && !toAcknowledge.length, blockers, toAcknowledge };
}

/**
 * Final export (spec C-6): Brand Guard never blocks it; only the missing human
 * approval does. Open findings are reported so the export dialog can warn.
 */
export function exportGate(
  contentApproved: boolean,
  reviewed: ReviewedReport | null,
): { allowed: boolean; openErrors: number; openWarnings: number; neverChecked: boolean } {
  return {
    allowed: contentApproved,
    openErrors: reviewed?.open.error ?? 0,
    openWarnings: reviewed?.open.warning ?? 0,
    neverChecked: !reviewed,
  };
}

/** Plain-text list for “Copy findings list”. */
export function findingsAsText(reviewed: ReviewedReport): string {
  const sev = { error: "Error", warning: "Warning", note: "Note" } as const;
  return reviewed.findings
    .map(
      (f) =>
        `${sev[f.severity]}${f.status === "ignored" ? " (ignored)" : ""} · ${f.message}${f.suggestion ? ` ${f.suggestion}` : ""} [${f.check}]`,
    )
    .join("\n");
}
