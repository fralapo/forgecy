import {
  blocks,
  completeness,
  diffVersions,
  parseDocument,
  publishChecks,
  referenceColors,
  type TokenTree,
} from "@forgecy/brand";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { brandPath, formatDate } from "../_lib/labels";
import { loadBrand, openConflicts, shownVersion } from "../_lib/server";
import { plural } from "@/lib/plural";

export const metadata = { title: "Brand Identity" };

const blockPage = {
  strategy: "strategy",
  verbal: "verbal",
  visual: "visual",
  content: "content",
  presence: "strategy",
} as const;

export default async function BrandOverviewPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client, ws } = await loadBrand(clientSlug);
  const shown = shownVersion(ws);
  const conflicts = await openConflicts(client.id);
  const base = brandPath(client.slug);
  const pending = ws.proposalCounts.proposed ?? 0;
  const sources = Object.values(ws.sourceCounts).reduce((a, b) => a + (b ?? 0), 0);
  const empty = !ws.versions.length && !sources && !pending;

  const publishedState = ws.published
    ? { document: parseDocument(ws.published.document), tokens: ws.published.tokens as TokenTree }
    : null;
  const draftChanges = ws.draft
    ? diffVersions(publishedState, { document: shown.document, tokens: shown.tokens })
    : [];
  const missing = new Map(
    completeness(shown.document, shown.tokens).map((c) => [c.block, c.missing]),
  );
  const checks = publishChecks(shown.document, shown.tokens, {
    publishedTokens: publishedState?.tokens ?? null,
    conflicts: conflicts.length,
  });

  const next = pending
    ? { label: `Rivedi ${pending} proposte`, href: `${base}/proposals` }
    : conflicts.length
      ? { label: `Risolvi ${conflicts.length} conflitti`, href: `${base}/proposals?conflicts=1` }
      : ws.draft
        ? {
            label: `Approva e pubblica la v${ws.draft.number}`,
            href: `${base}/versions/${ws.draft.number}/approve`,
          }
        : null;

  if (empty)
    return (
      <Card className="p-8">
        <h2 className="text-heading-md text-fg">La Brand Identity di {client.name} è vuota.</h2>
        <p className="mt-2 text-body-md text-fg-muted">Scegli da dove partire.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-medium text-primary-foreground"
            href={`${base}/sources?import=1` as Route}
          >
            Importa brand book
          </Link>
          <Link
            className="inline-flex h-10 items-center rounded-md border border-control bg-surface px-4 text-body-sm text-fg"
            href={`${base}/sources` as Route}
          >
            Aggiungi fonte
          </Link>
          <Link
            className="inline-flex h-10 items-center rounded-md border border-control bg-surface px-4 text-body-sm text-fg"
            href={`${base}/strategy` as Route}
          >
            Compila a mano
          </Link>
        </div>
      </Card>
    );

  const palette = referenceColors(shown.tokens).slice(0, 6);

  return (
    <div className="space-y-6">
      <p className="text-body-md text-fg">
        <span className="text-fg-muted">Prossima azione: </span>
        {next ? (
          <Link href={next.href as Route}>{next.label}</Link>
        ) : ws.published ? (
          `Nessuna azione in sospeso · v${ws.published.number} pubblicata il ${formatDate(ws.published.publishedAt)}`
        ) : (
          "Compila i blocchi e pubblica la prima versione"
        )}
      </p>

      <section aria-labelledby="pipeline" className="grid gap-3 md:grid-cols-4">
        <h2 id="pipeline" className="sr-only">
          Stato della Brand Identity
        </h2>
        {[
          {
            label: "Fonti",
            value: `${sources}`,
            detail: ws.sourceCounts.failed ? `${ws.sourceCounts.failed} non riuscite` : "",
            href: "sources",
          },
          {
            label: "Proposte in attesa",
            value: `${pending}`,
            detail: `${ws.proposalCounts.accepted ?? 0} accettate`,
            href: "proposals",
          },
          {
            label: "Bozza",
            value: ws.draft ? `v${ws.draft.number}` : "—",
            detail: ws.draft
              ? `${plural(draftChanges.length, "modifica", "modifiche")} rispetto alla pubblicata`
              : "",
            href: "versions",
          },
          {
            label: "Pubblicata",
            value: ws.published ? `v${ws.published.number}` : "—",
            detail: ws.published ? formatDate(ws.published.publishedAt) : "",
            href: "versions",
          },
        ].map((n) => (
          <Link
            key={n.label}
            href={`${base}/${n.href}` as Route}
            className="rounded-lg border border-subtle bg-surface p-4 text-fg hover:border-control"
          >
            <span className="block text-label text-fg-muted">{n.label}</span>
            <span className="block text-heading-md">{n.value}</span>
            {n.detail ? <span className="block text-body-sm text-fg-muted">{n.detail}</span> : null}
          </Link>
        ))}
      </section>

      <section aria-labelledby="blocks" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <h2 id="blocks" className="sr-only">
          Blocchi
        </h2>
        {(["strategy", "verbal", "visual", "content"] as const).map((b) => {
          const m = missing.get(b) ?? [];
          const changes = draftChanges.filter((c) => c.block === b).length;
          return (
            <Card key={b} className="flex flex-col gap-3 p-5">
              <h3 className="text-heading-sm text-fg">{blocks[b]}</h3>
              {m.length ? (
                <p className="text-body-sm text-fg-muted">Manca: {m.join(", ")}</p>
              ) : (
                <Badge variant="success">Completo</Badge>
              )}
              {changes ? (
                <p className="text-body-sm text-fg">
                  {plural(changes, "modifica", "modifiche")} nella bozza
                </p>
              ) : null}
              {b === "strategy" && shown.document.strategy.oneLiner ? (
                <p className="text-body-sm text-fg">«{shown.document.strategy.oneLiner.value}»</p>
              ) : null}
              {b === "visual" && palette.length ? (
                <ul className="flex gap-1" aria-label="Palette">
                  {palette.map((c) => (
                    <li
                      key={c.name}
                      title={`${c.name} ${c.hex}`}
                      className="size-6 rounded-sm border border-subtle"
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </ul>
              ) : null}
              <Link href={`${base}/${blockPage[b]}` as Route} className="mt-auto text-body-sm">
                Apri blocco
              </Link>
            </Card>
          );
        })}
      </section>

      <Card className="p-5">
        <h2 className="text-heading-sm text-fg">Pronto per la pubblicazione?</h2>
        {checks.length ? (
          <>
            <ul className="mt-3 space-y-1 text-body-sm text-fg">
              {checks.map((c) => (
                <li key={c.key}>
                  <span className="text-warning">Da confermare:</span> {c.message}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-body-sm text-fg-muted">
              Potrai pubblicare confermando ogni punto aperto.
            </p>
          </>
        ) : (
          <p className="mt-3 text-body-sm text-success">Nessun controllo aperto.</p>
        )}
      </Card>
    </div>
  );
}
