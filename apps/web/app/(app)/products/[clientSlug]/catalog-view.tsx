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
                {chosen.length === 1 ? "1 product selected" : `${chosen.length} products selected`}
              </span>
              <ConfirmDialog
                title={`Approve ${approvable.length} products?`}
                confirmLabel={
                  sensitive ? `Approve the other ${approvable.length}` : "Approve products"
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
                    Approve selected
                  </Button>
                )}
              >
                <p>They become usable in {props.clientName}’s carousels.</p>
                {sensitive ? (
                  <p>
                    {sensitive} products have sensitive fields to accept one by one. They will be
                    skipped.
                  </p>
                ) : null}
                {chosen.length - approvable.length - sensitive > 0 ? (
                  <p>
                    {chosen.length - approvable.length - sensitive} products are not proposed or in
                    draft: they will be skipped.
                  </p>
                ) : null}
                <label className="block text-body-sm text-fg">
                  Note (optional)
                  <textarea
                    name="note"
                    rows={2}
                    maxLength={1000}
                    className="mt-1 w-full rounded-md border border-control bg-surface p-2"
                  />
                </label>
              </ConfirmDialog>
              <ConfirmDialog
                title={`Reject ${chosen.length} products?`}
                confirmLabel="Reject products"
                onConfirm={(f) =>
                  bulk(
                    "reject",
                    chosen.map((r) => r.id),
                    String(f.get("note") ?? ""),
                  )
                }
                trigger={(open) => (
                  <Button size="sm" variant="secondary" onClick={open} disabled={pending}>
                    Reject selected
                  </Button>
                )}
              >
                <label className="block text-body-sm text-fg">
                  Reason (optional)
                  <textarea
                    name="note"
                    rows={2}
                    maxLength={1000}
                    className="mt-1 w-full rounded-md border border-control bg-surface p-2"
                  />
                </label>
              </ConfirmDialog>
              <ConfirmDialog
                title={`Archive ${chosen.length} products?`}
                confirmLabel="Archive products"
                danger
                onConfirm={() =>
                  bulk(
                    "archive",
                    chosen.map((r) => r.id),
                  )
                }
                trigger={(open) => (
                  <Button size="sm" variant="secondary" onClick={open} disabled={pending}>
                    Archive selected
                  </Button>
                )}
              >
                <p>
                  They will no longer be suggested in briefs. Carousels that use them stay
                  unchanged.
                </p>
              </ConfirmDialog>
            </>
          ) : (
            <span className="text-fg-muted">
              {props.total === 1 ? "1 product" : `${props.total} products`}
              {props.filtered ? " with these filters" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <a href={props.exportHref}>
              <Download aria-hidden />
              Export CSV
            </a>
          </Button>
          <div role="group" aria-label="View" className="flex">
            <Button
              size="sm"
              variant={props.view === "table" ? "secondary" : "ghost"}
              aria-pressed={props.view === "table"}
              onClick={() => router.push(paths.catalog(clientSlug, viewQuery("table")))}
            >
              <Table2 aria-hidden />
              Table
            </Button>
            <Button
              size="sm"
              variant={props.view === "grid" ? "secondary" : "ghost"}
              aria-pressed={props.view === "grid"}
              onClick={() => router.push(paths.catalog(clientSlug, viewQuery("grid")))}
            >
              <LayoutGrid aria-hidden />
              Grid
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
                aria-label={`Select ${r.name}`}
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
            <caption className="sr-only">Products</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all products on this page"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                    }
                    className="size-4"
                  />
                </th>
                <th scope="col" className="px-2 py-3 font-medium">
                  <span className="sr-only">Thumbnail</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  SKU
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Category
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Completeness
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Source
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Used in
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Last modified
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
                      aria-label={`Select ${r.name}`}
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
                          Sensitive fields to accept
                        </span>
                      ) : null}
                      {r.openProposals ? (
                        <span className="inline-flex items-center gap-1">
                          <GitPullRequest aria-hidden className="size-4" />
                          {r.openProposals === 1 ? "1 proposal" : `${r.openProposals} proposals`}
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
                    {r.byAgent ? "Proposed by Brand Analyst · " : ""}
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
          aria-label="Pages"
          className="flex items-center justify-end gap-2 border-t border-subtle px-4 py-3 text-body-sm"
        >
          {props.page > 1 ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={paths.catalog(clientSlug, pageQuery(props.page - 1))}>Previous</Link>
            </Button>
          ) : null}
          <span className="text-fg-muted">
            Page {props.page} of {props.pages}
          </span>
          {props.page < props.pages ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={paths.catalog(clientSlug, pageQuery(props.page + 1))}>Next</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
