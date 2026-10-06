import { Badge } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ActionButton } from "../_components/action-button";
import { BrandTabs } from "../_components/brand-tabs";
import { startDraftAction, submitAction } from "../actions";
import { brandPath, formatDate, versionStatusLabel, versionStatusVariant } from "../_lib/labels";
import { loadBrand, openConflicts, userNames } from "../_lib/server";

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
    { href: base, label: "Panoramica" },
    { href: `${base}/strategy`, label: "Strategia" },
    { href: `${base}/verbal`, label: "Verbale" },
    { href: `${base}/visual`, label: "Visual" },
    { href: `${base}/content`, label: "Contenuti" },
    {
      href: `${base}/sources`,
      label: "Fonti",
      count: Object.values(ws.sourceCounts).reduce((a, b) => a + (b ?? 0), 0),
    },
    { href: `${base}/proposals`, label: "Proposte", count: ws.proposalCounts.proposed ?? 0 },
    { href: `${base}/versions`, label: "Versioni" },
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
            <Badge variant="success">v{published.number} · Pubblicata</Badge>
          ) : (
            <Badge>Nessuna versione pubblicata</Badge>
          )}
        </div>
      </header>
      <BrandTabs tabs={tabs} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-subtle bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-body-sm">
          {draft ? (
            <>
              <Badge variant={versionStatusVariant[draft.status]}>
                Bozza v{draft.number} · {versionStatusLabel[draft.status]}
              </Badge>
              <span className="text-fg-muted">
                Ultima modifica: {editor ?? "—"}, {formatDate(draft.updatedAt)}
              </span>
            </>
          ) : (
            <span className="text-fg-muted">
              {published
                ? `Nessuna bozza aperta: si lavora sulla v${published.number} pubblicata in sola lettura.`
                : "Nessuna bozza: inizia compilando un blocco o importando un brand book."}
            </span>
          )}
          {conflicts.length ? (
            <Badge variant="warning">{conflicts.length} conflitti aperti</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!draft ? (
            <ActionButton
              action={startDraftAction.bind(null, client.slug, client.id)}
              variant="secondary"
            >
              {published ? `Apri la bozza v${published.number + 1}` : "Inizia la bozza"}
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
              Invia in revisione
            </ActionButton>
          ) : null}
          {draft ? (
            <Link
              href={`${base}/versions/${draft.number}/approve` as Route}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-medium text-primary-foreground"
            >
              Apri approvazione
            </Link>
          ) : null}
        </div>
      </div>
      {draft?.status === "in_review" ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-warning-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          La bozza v{draft.number} è in revisione: puoi ancora modificarla; ogni modifica va riletta
          prima di pubblicare.
          {draft.reviewComment ? ` Commento: ${draft.reviewComment}` : ""}
        </p>
      ) : null}
      {draft?.status === "draft" && draft.reviewComment ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-subtle bg-surface px-4 py-3 text-body-sm text-fg"
        >
          Rimandata con commento: {draft.reviewComment}
        </p>
      ) : null}
      {!published ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-error-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          Nessuna versione pubblicata: i caroselli di {client.name} non si possono generare.
        </p>
      ) : null}
      {children}
    </>
  );
}
