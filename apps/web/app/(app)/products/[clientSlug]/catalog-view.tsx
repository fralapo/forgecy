"use client";

import type { ProductStatus } from "@forgecy/core";
import { Button, cn } from "@forgecy/ui";
import { Download, GitPullRequest, LayoutGrid, ShieldAlert, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionMessage, ConfirmDialog, useCatalogAction } from "../_components/client";
import { CompletenessMeter, ProductStatusBadge, Thumb } from "../_components/ui";
import { shortWhen } from "../_lib/labels";
import { paths } from "../_lib/paths";
import { transitionAction } from "./actions";

export interface CatalogViewRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  status: ProductStatus;
  revision: number;
  byAgent: boolean;
  completeness: "complete" | "partial" | "minimal";
  source: string;
  openProposals: number;
  sensitivePending: boolean;
  updated: string;
  updatedBy: string | null;
  thumb: string | null;
}

export function CatalogView(props: {
  rows: CatalogViewRow[];
  view: "table" | "grid";
  clientId: string;
  clientName: string;
  clientSlug: string;
  exportHref: string;
  query: string;
  page: number;
  pages: number;
  total: number;
  filtered: boolean;
}) {
  const { rows, clientSlug } = props;
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { pending, result, run } = useCatalogAction();
  const chosen = rows.filter((r) => selected.has(r.id));
  const approvable = chosen.filter(
    (r) => (r.status === "proposed" || r.status === "draft") && !r.sensitivePending,
  );
  const sensitive = chosen.filter((r) => r.sensitivePending).length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function bulk(action: "approve" | "reject" | "archive", ids: string[], note?: string) {
    run(
      () => transitionAction({ clientId: props.clientId, ids, action, note }),
      (r) => r.ok && setSelected(new Set()),
    );
  }
  const viewQuery = (view: "table" | "grid") => {
    const q = new URLSearchParams(props.query);
    q.set("view", view);
    return q.toString();
  };
  const pageQuery = (page: number) => {
    const q = new URLSearchParams(props.query);
    q.set("page", String(page));
    return q.toString();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-4 py-3">
        <div aria-live="polite" className="flex flex-wrap items-center gap-2 text-body-sm">
          {chosen.length ? (
            <>
              <span className="text-fg">
                {chosen.length === 1
                  ? "1 prodotto selezionato"
                  : `${chosen.length} prodotti selezionati`}
              </span>
              <ConfirmDialog
                title={`Approvare ${approvable.length} prodotti?`}
                confirmLabel={
                  sensitive ? `Approva gli altri ${approvable.length}` : "Approva prodotti"
                }
                disabled={approvable.length === 0}
                onConfirm={(f) =>
                  bulk(
                    "approve",
                    approvable.map((r) => r.id),
                    String(f.get("note") ?? ""),
                  )
                }
                trigger={(open) => (
                  <Button size="sm" onClick={open} disabled={pending}>
                    Approva selezionati
                  </Button>
                )}
              >
                <p>Diventano utilizzabili nei caroselli di {props.clientName}.</p>
                {sensitive ? (
                  <p>
                    {sensitive} prodotti hanno campi sensibili da accettare uno per uno. Verranno
                    esclusi.
                  </p>
                ) : null}
                {chosen.length - approvable.length - sensitive > 0 ? (
                  <p>
                    {chosen.length - approvable.length - sensitive} prodotti non sono proposti o in
                    bozza: verranno esclusi.
                  </p>
                ) : null}
                <label className="block text-body-sm text-fg">
                  Nota (facoltativa)
                  <textarea
                    name="note"
                    rows={2}
                    maxLength={1000}
                    className="mt-1 w-full rounded-md border border-control bg-surface p-2"
                  />
                </label>
              </ConfirmDialog>
              <ConfirmDialog
                title={`Rifiutare ${chosen.length} prodotti?`}
                confirmLabel="Rifiuta prodotti"
                onConfirm={(f) =>
                  bulk(
                    "reject",
                    chosen.map((r) => r.id),
                    String(f.get("note") ?? ""),
                  )
                }
                trigger={(open) => (
                  <Button size="sm" variant="secondary" onClick={open} disabled={pending}>
                    Rifiuta selezionati
                  </Button>
                )}
              >
                <label className="block text-body-sm text-fg">
                  Motivo (facoltativo)
                  <textarea
                    name="note"
                    rows={2}
                    maxLength={1000}
                    className="mt-1 w-full rounded-md border border-control bg-surface p-2"
                  />
                </label>
              </ConfirmDialog>
              <ConfirmDialog
                title={`Archiviare ${chosen.length} prodotti?`}
                confirmLabel="Archivia prodotti"
                danger
                onConfirm={() =>
                  bulk(
                    "archive",
                    chosen.map((r) => r.id),
                  )
                }
                trigger={(open) => (
                  <Button size="sm" variant="secondary" onClick={open} disabled={pending}>
                    Archivia selezionati
                  </Button>
                )}
              >
                <p>
                  Non saranno più proposti nei brief. I caroselli che li usano restano invariati.
                </p>
              </ConfirmDialog>
            </>
          ) : (
            <span className="text-fg-muted">
              {props.total === 1 ? "1 prodotto" : `${props.total} prodotti`}
              {props.filtered ? " con questi filtri" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <a href={props.exportHref}>
              <Download aria-hidden />
              Esporta CSV
            </a>
          </Button>
          <div role="group" aria-label="Vista" className="flex">
            <Button
              size="sm"
              variant={props.view === "table" ? "secondary" : "ghost"}
              aria-pressed={props.view === "table"}
              onClick={() => router.push(paths.catalog(clientSlug, viewQuery("table")))}
            >
              <Table2 aria-hidden />
              Tabella
            </Button>
            <Button
              size="sm"
              variant={props.view === "grid" ? "secondary" : "ghost"}
              aria-pressed={props.view === "grid"}
              onClick={() => router.push(paths.catalog(clientSlug, viewQuery("grid")))}
            >
              <LayoutGrid aria-hidden />
              Griglia
            </Button>
          </div>
        </div>
      </div>
      <div className="px-4">
        <ActionMessage result={result} />
      </div>

      {props.view === "grid" ? (
        <ul className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map((r) => (
            <li key={r.id} className="relative rounded-lg border border-subtle bg-surface p-3">
              <input
                type="checkbox"
                aria-label={`Seleziona ${r.name}`}
                checked={selected.has(r.id)}
                onChange={() => toggle(r.id)}
                className="absolute left-5 top-5 z-10 size-4"
              />
              <Link href={paths.product(clientSlug, r.id)} className="block space-y-2">
                <Thumb url={r.thumb} alt={r.name} size="lg" />
                <span className="block text-body-md text-fg">{r.name}</span>
                {r.sku ? (
                  <span className="block font-mono text-body-sm text-fg-muted">{r.sku}</span>
                ) : null}
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ProductStatusBadge status={r.status} byAgent={r.byAgent} />
                <CompletenessMeter level={r.completeness} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-body-sm">
            <caption className="sr-only">Prodotti</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Seleziona tutti i prodotti della pagina"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                    }
                    className="size-4"
                  />
                </th>
                <th scope="col" className="px-2 py-3 font-medium">
                  <span className="sr-only">Miniatura</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Nome
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  SKU
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Categoria
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Stato
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Completezza
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Fonte
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Usato in
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Ultima modifica
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    "border-b border-subtle last:border-0 hover:bg-app",
                    selected.has(r.id) && "bg-app",
                  )}
                >
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Seleziona ${r.name}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="size-4"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Thumb url={r.thumb} alt={r.name} />
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={paths.product(clientSlug, r.id)}
                      className="text-fg hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="mt-1 flex gap-2 text-fg-muted">
                      {r.sensitivePending ? (
                        <span className="inline-flex items-center gap-1">
                          <ShieldAlert aria-hidden className="size-4" />
                          Campi sensibili da accettare
                        </span>
                      ) : null}
                      {r.openProposals ? (
                        <span className="inline-flex items-center gap-1">
                          <GitPullRequest aria-hidden className="size-4" />
                          {r.openProposals === 1 ? "1 proposta" : `${r.openProposals} proposte`}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-fg-muted">{r.sku ?? "—"}</td>
                  <td className="px-4 py-2 text-fg-muted">{r.category ?? "—"}</td>
                  <td className="px-4 py-2">
                    <ProductStatusBadge status={r.status} byAgent={r.byAgent} />
                  </td>
                  <td className="px-4 py-2">
                    <CompletenessMeter level={r.completeness} />
                  </td>
                  <td className="px-4 py-2 text-fg-muted">
                    {r.byAgent ? "Proposto da Brand Analyst · " : ""}
                    {r.source}
                  </td>
                  <td className="px-4 py-2 text-fg-muted">—</td>
                  <td className="px-4 py-2 text-fg-muted">
                    {shortWhen(new Date(r.updated))}
                    {r.updatedBy ? ` · ${r.updatedBy}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.pages > 1 ? (
        <nav
          aria-label="Pagine"
          className="flex items-center justify-end gap-2 border-t border-subtle px-4 py-3 text-body-sm"
        >
          {props.page > 1 ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={paths.catalog(clientSlug, pageQuery(props.page - 1))}>Precedente</Link>
            </Button>
          ) : null}
          <span className="text-fg-muted">
            Pagina {props.page} di {props.pages}
          </span>
          {props.page < props.pages ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={paths.catalog(clientSlug, pageQuery(props.page + 1))}>Successiva</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
