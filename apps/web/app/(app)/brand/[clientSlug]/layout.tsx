import { Badge } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ActionButton } from "../_components/action-button";
import { BrandTabs } from "../_components/brand-tabs";
import { startDraftAction, submitAction } from "../actions";
import { brandPath, formatDate, versionStatusLabel, versionStatusVariant } from "../_lib/labels";
import { loadBrand, openConflicts, userNames } from "../_lib/server";
import { plural } from "@/lib/plural";

export default async function BrandLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client, ws } = await loadBrand(clientSlug);
  const conflicts = await openConflicts(client.id);
  const { draft, published } = ws;
  const names = await userNames([draft?.lastEditedBy, draft?.createdBy]);
  const base = brandPath(client.slug);
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/strategy`, label: "Strategy" },
    { href: `${base}/verbal`, label: "Verbal" },
    { href: `${base}/visual`, label: "Visual" },
    { href: `${base}/content`, label: "Content" },
    {
      href: `${base}/sources`,
      label: "Sources",
      count: Object.values(ws.sourceCounts).reduce((a, b) => a + (b ?? 0), 0),
    },
    { href: `${base}/proposals`, label: "Proposals", count: ws.proposalCounts.proposed ?? 0 },
    { href: `${base}/versions`, label: "Versions" },
  ];
  const editor = draft ? names.get(draft.lastEditedBy ?? draft.createdBy ?? "") : undefined;

  return (
    <>
      <header className="mb-6">
        <p className="text-body-sm text-fg-muted">
          <Link href="/brand">Brand Identity</Link> › {client.name}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-heading-lg text-fg">Brand Identity · {client.name}</h1>
          {published ? (
            <Badge variant="success">v{published.number} · Published</Badge>
          ) : (
            <Badge>No published version</Badge>
          )}
        </div>
      </header>
      <BrandTabs tabs={tabs} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-subtle bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-body-sm">
          {draft ? (
            <>
              <Badge variant={versionStatusVariant[draft.status]}>
                Draft v{draft.number} · {versionStatusLabel[draft.status]}
              </Badge>
              <span className="text-fg-muted">
                Last edited: {editor ?? "—"}, {formatDate(draft.updatedAt)}
              </span>
            </>
          ) : (
            <span className="text-fg-muted">
              {published
                ? `No open draft: published v${published.number} is shown read-only.`
                : "No draft: start by filling in a block or importing a brand book."}
            </span>
          )}
          {conflicts.length ? (
            <Badge variant="warning">
              {plural(conflicts.length, "open conflict", "open conflicts")}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!draft ? (
            <ActionButton
              action={startDraftAction.bind(null, client.slug, client.id)}
              variant="secondary"
            >
              {published ? `Open draft v${published.number + 1}` : "Start the draft"}
            </ActionButton>
          ) : null}
          {draft?.status === "draft" ? (
            <ActionButton
              action={submitAction.bind(null, {
                slug: client.slug,
                clientId: client.id,
                versionId: draft.id,
                rev: draft.rev,
              })}
              variant="secondary"
            >
              Send for review
            </ActionButton>
          ) : null}
          {draft ? (
            <Link
              href={`${base}/versions/${draft.number}/approve` as Route}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-medium text-primary-foreground"
            >
              Open approval
            </Link>
          ) : null}
        </div>
      </div>
      {draft?.status === "in_review" ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-warning-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          Draft v{draft.number} is in review: you can still edit it; every change must be reread
          before publishing.
          {draft.reviewComment ? ` Comment: ${draft.reviewComment}` : ""}
        </p>
      ) : null}
      {draft?.status === "draft" && draft.reviewComment ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-subtle bg-surface px-4 py-3 text-body-sm text-fg"
        >
          Sent back with comment: {draft.reviewComment}
        </p>
      ) : null}
      {!published ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-error-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          No published version: carousels for {client.name} can’t be generated.
        </p>
      ) : null}
      {children}
    </>
  );
}
