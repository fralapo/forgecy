import {
  blocks,
  confidenceReason,
  currentValue,
  listProposals,
  matchField,
  proposedValue,
  type JsonPatch,
} from "@forgecy/brand";
import { Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { ProposalList, type ProposalView } from "../../_components/proposal-list";
import { agentRoleLabel, brandPath, formatDate, proposalStatusLabel } from "../../_lib/labels";
import { loadBrand, openConflicts, shownVersion, sourcesFor, userNames } from "../../_lib/server";

export const metadata = { title: "Proposals · Brand Identity" };

const statuses = ["proposed", "accepted", "rejected", "stale"] as const;

export default async function ProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const { db, user, client, ws } = await loadBrand(clientSlug);
  const status = statuses.find((s) => s === sp.status) ?? "proposed";
  const field = typeof sp.field === "string" ? sp.field : undefined;
  const onlyConflicts = sp.conflicts === "1";
  const [rows, sources, conflicts] = await Promise.all([
    listProposals(db, user.actor, client.id, { status }),
    sourcesFor(client.id),
    openConflicts(client.id),
  ]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const conflictOf = new Map(conflicts.flatMap((c) => c.proposalIds.map((id) => [id, c] as const)));
  const names = await userNames(rows.flatMap((r) => [r.authorUserId, r.reviewedBy]));
  const shown = shownVersion(ws);
  const state = { document: shown.document, tokens: shown.tokens };
  const base = brandPath(client.slug, "proposals");

  const views: ProposalView[] = rows
    .filter((p) => !field || p.fieldPath === field || p.fieldPath.startsWith(`${field}/`))
    .filter((p) => !onlyConflicts || conflictOf.has(p.id))
    .map((p) => {
      const match = matchField(p.fieldPath.replace(/\[.*\]$/, "").replace(/\/-$/, ""));
      const patch = p.changes as JsonPatch;
      const proposed = match ? proposedValue(patch, match.field) : undefined;
      const current =
        match && status === "proposed" ? currentValue(state, patch, match.field) : undefined;
      const kinds = p.evidence.map((e) => sourceById.get(e.sourceId)?.kind).filter((k) => !!k);
      const conflict = conflictOf.get(p.id);
      return {
        id: p.id,
        title: p.title,
        block: match ? blocks[match.field.block] : "Other",
        fieldPath: p.fieldPath,
        status: p.status,
        statusLabel: proposalStatusLabel[p.status],
        author:
          p.authorType === "agent"
            ? (agentRoleLabel[p.agentRole ?? ""] ?? p.agentRole ?? "Agent")
            : (names.get(p.authorUserId ?? "") ?? "Person"),
        authorType: p.authorType,
        createdAt: formatDate(p.createdAt),
        rationale: p.rationale,
        proposed,
        current,
        editable:
          typeof proposed === "string" ||
          (typeof proposed === "object" &&
            proposed !== null &&
            !Array.isArray(proposed) &&
            !("$value" in proposed) &&
            Object.values(proposed).every((v) => typeof v === "string" || v === undefined)),
        confidence: conflict ? "low" : p.confidence,
        confidenceReason: confidenceReason(kinds as never, { conflicting: !!conflict }),
        sensitive: p.sensitive,
        checks: p.checks.filter((c) => c.level === "warning").map((c) => c.message),
        evidence: p.evidence.map((e) => ({
          title: sourceById.get(e.sourceId)?.title ?? "Removed source",
          locator: e.locator ?? null,
          quote: e.quote ?? null,
        })),
        conflict: conflict
          ? { suggested: conflict.suggestedId === p.id, size: conflict.proposalIds.length }
          : null,
        review:
          p.status === "proposed"
            ? null
            : {
                by: names.get(p.reviewedBy ?? "") ?? null,
                at: p.reviewedAt ? formatDate(p.reviewedAt) : null,
                note: p.reviewNote ?? p.staleReason ?? null,
              },
      };
    });

  return (
    <div className="space-y-6">
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2 text-body-sm">
        {statuses.map((s) => (
          <Link
            key={s}
            href={`${base}?status=${s}` as Route}
            aria-current={s === status ? "page" : undefined}
            className={
              s === status
                ? "rounded-md border border-primary bg-surface px-3 py-1 text-fg"
                : "rounded-md border border-subtle bg-surface px-3 py-1 text-fg-muted"
            }
          >
            {proposalStatusLabel[s]}
            {s === "proposed" && ws.proposalCounts.proposed
              ? ` (${ws.proposalCounts.proposed})`
              : ""}
          </Link>
        ))}
        {conflicts.length ? (
          <Link
            href={`${base}?conflicts=1` as Route}
            className="rounded-md border border-warning-fill bg-surface px-3 py-1 text-fg"
          >
            Conflicts only ({conflicts.length})
          </Link>
        ) : null}
        {field || onlyConflicts ? (
          <Link href={base as Route} className="px-3 py-1">
            Clear filters
          </Link>
        ) : null}
      </nav>
      {views.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">
            {status === "proposed" ? "No pending proposals." : "No proposals with this status."}
          </p>
        </Card>
      ) : (
        <ProposalList
          slug={client.slug}
          clientId={client.id}
          proposals={views}
          reviewable={status === "proposed"}
        />
      )}
    </div>
  );
}
