import {
  confidenceReasonRef,
  currentValue,
  fieldLabel,
  listProposals,
  matchField,
  proposedValue,
  type JsonPatch,
} from "@forgecy/brand";
import { Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import type { MessageRef } from "@forgecy/core";
import { getTranslations } from "next-intl/server";
import { ProposalList, type ProposalView } from "../../_components/proposal-list";
import { brandPath, fieldMessageKey } from "../../_lib/labels";
import { loadBrand, openConflicts, shownVersion, sourcesFor, userNames } from "../../_lib/server";
import { getFormat, getRefText, refText } from "@/lib/i18n";
import { importTextRef } from "../../_lib/stored-text";

export async function generateMetadata() {
  const t = await getTranslations("brand.meta");
  return { title: t("proposals") };
}

const statuses = ["proposed", "accepted", "rejected", "stale"] as const;

export default async function ProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const t = await getTranslations("brand");
  const root = await getTranslations();
  const rt = await getRefText();
  const format = await getFormat();
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

  // A title the service filled in from the field ("Strategy › One-liner") is shown translated.
  const fieldTitle = (pointer: string) => {
    const match = matchField(pointer);
    if (!match) return null;
    const key = fieldMessageKey(match.field.pointer);
    if (!root.has(key)) return null;
    const values = { block: t(`blocks.${match.field.block}`), field: root(key) };
    return match.field.shape === "token-group" && match.rest
      ? t("fieldPathToken", { ...values, token: match.rest.slice(1).replace(/\//g, ".") })
      : t("fieldPath", values);
  };
  const agentName = (role: string | null) =>
    role && t.has(`agentRole.${role}` as never)
      ? t(`agentRole.${role}` as never)
      : (role ?? t("agentRole.agent"));
  const checkText = (c: { message: string; ref?: MessageRef }) => refText(c.ref, c.message);

  const filtered = rows
    .filter((p) => !field || p.fieldPath === field || p.fieldPath.startsWith(`${field}/`))
    .filter((p) => !onlyConflicts || conflictOf.has(p.id));
  const views: ProposalView[] = await Promise.all(
    filtered.map(async (p) => {
      const match = matchField(p.fieldPath.replace(/\[.*\]$/, "").replace(/\/-$/, ""));
      const patch = p.changes as JsonPatch;
      const proposed = match ? proposedValue(patch, match.field) : undefined;
      const current =
        match && status === "proposed" ? currentValue(state, patch, match.field) : undefined;
      const kinds = p.evidence.map((e) => sourceById.get(e.sourceId)?.kind).filter((k) => !!k);
      const conflict = conflictOf.get(p.id);
      const autoTitle = p.title === fieldLabel(p.fieldPath) ? fieldTitle(p.fieldPath) : null;
      return {
        id: p.id,
        title: autoTitle ?? rt(p.titleRef ?? importTextRef(p.title), p.title),
        block: match ? t(`blocks.${match.field.block}`) : t("blocks.other"),
        fieldPath: p.fieldPath,
        status: p.status,
        statusLabel: t(`proposalStatus.${p.status}`),
        author:
          p.authorType === "agent"
            ? agentName(p.agentRole)
            : (names.get(p.authorUserId ?? "") ?? t("proposals.person")),
        authorType: p.authorType,
        createdAt: format.date(p.createdAt, "dateTime"),
        rationale: p.rationale
          ? rt(p.rationaleRef ?? importTextRef(p.rationale), p.rationale)
          : null,
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
        confidenceReason: await refText(
          confidenceReasonRef(kinds as never, { conflicting: !!conflict }),
          "",
        ),
        sensitive: p.sensitive,
        checks: await Promise.all(
          p.checks.filter((c) => c.level === "warning").map((c) => checkText(c)),
        ),
        evidence: p.evidence.map((e) => ({
          title: sourceById.get(e.sourceId)?.title ?? t("proposals.removedSource"),
          locator: e.locator ? rt(importTextRef(e.locator), e.locator) : null,
          quote: e.quote ? rt(importTextRef(e.quote), e.quote) : null,
        })),
        conflict: conflict
          ? { suggested: conflict.suggestedId === p.id, size: conflict.proposalIds.length }
          : null,
        review:
          p.status === "proposed"
            ? null
            : {
                by: names.get(p.reviewedBy ?? "") ?? null,
                at: p.reviewedAt ? format.date(p.reviewedAt, "dateTime") : null,
                note:
                  p.reviewNote ??
                  (p.staleReason
                    ? rt(p.staleRef ?? importTextRef(p.staleReason), p.staleReason)
                    : null),
              },
      };
    }),
  );

  return (
    <div className="space-y-6">
      <nav aria-label={t("proposals.filterLabel")} className="flex flex-wrap gap-2 text-body-sm">
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
            {s === "proposed" && ws.proposalCounts.proposed
              ? t("proposals.proposedCount", {
                  status: t(`proposalStatus.${s}`),
                  count: ws.proposalCounts.proposed,
                })
              : t(`proposalStatus.${s}`)}
          </Link>
        ))}
        {conflicts.length ? (
          <Link
            href={`${base}?conflicts=1` as Route}
            className="rounded-md border border-warning-fill bg-surface px-3 py-1 text-fg"
          >
            {t("proposals.conflictsOnly", { count: conflicts.length })}
          </Link>
        ) : null}
        {field || onlyConflicts ? (
          <Link href={base as Route} className="px-3 py-1">
            {t("proposals.clearFilters")}
          </Link>
        ) : null}
      </nav>
      {views.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">
            {status === "proposed" ? t("proposals.nonePending") : t("proposals.noneWithStatus")}
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
