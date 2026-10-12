"use client";

import type { ProductStatus } from "@forgecy/core";
import { Button, cn } from "@forgecy/ui";
import { Download, GitPullRequest, LayoutGrid, ShieldAlert, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFormat } from "@/lib/use-format";
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
  const t = useTranslations("products");
  const format = useFormat();
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
              <span className="text-fg">{t("list.selected", { count: chosen.length })}</span>
              <ConfirmDialog
                title={t("list.approveTitle", { count: approvable.length })}
                confirmLabel={
                  sensitive
                    ? t("list.approveOthers", { count: approvable.length })
                    : t("list.approveProducts")
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
                    {t("list.approveSelected")}
                  </Button>
                )}
              >
                <p>{t("usableInCarousels", { client: props.clientName })}</p>
                {sensitive ? <p>{t("list.sensitiveSkipped", { count: sensitive })}</p> : null}
                {chosen.length - approvable.length - sensitive > 0 ? (
                  <p>
                    {t("list.notApprovableSkipped", {
                      count: chosen.length - approvable.length - sensitive,
                    })}
                  </p>
                ) : null}
                <label className="block text-body-sm text-fg">
                  {t("noteOptional")}
                  <textarea
                    name="note"
                    rows={2}
                    maxLength={1000}
                    className="mt-1 w-full rounded-md border border-control bg-surface p-2"
                  />
                </label>
              </ConfirmDialog>
              <ConfirmDialog
                title={t("list.rejectTitle", { count: chosen.length })}
                confirmLabel={t("list.rejectProducts")}
                onConfirm={(f) =>
                  bulk(
                    "reject",
                    chosen.map((r) => r.id),
                    String(f.get("note") ?? ""),
                  )
                }
                trigger={(open) => (
                  <Button size="sm" variant="secondary" onClick={open} disabled={pending}>
                    {t("list.rejectSelected")}
                  </Button>
                )}
              >
                <label className="block text-body-sm text-fg">
                  {t("reasonOptional")}
                  <textarea
                    name="note"
                    rows={2}
                    maxLength={1000}
                    className="mt-1 w-full rounded-md border border-control bg-surface p-2"
                  />
                </label>
              </ConfirmDialog>
              <ConfirmDialog
                title={t("list.archiveTitle", { count: chosen.length })}
                confirmLabel={t("list.archiveProducts")}
                danger
                onConfirm={() =>
                  bulk(
                    "archive",
                    chosen.map((r) => r.id),
                  )
                }
                trigger={(open) => (
                  <Button size="sm" variant="secondary" onClick={open} disabled={pending}>
                    {t("list.archiveSelected")}
                  </Button>
                )}
              >
                <p>{t("list.archiveBody")}</p>
              </ConfirmDialog>
            </>
          ) : (
            <span className="text-fg-muted">
              {props.filtered
                ? t("list.totalFiltered", { count: props.total })
                : t("list.total", { count: props.total })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <a href={props.exportHref}>
              <Download aria-hidden />
              {t("list.exportCsv")}
            </a>
          </Button>
          <div role="group" aria-label={t("list.view")} className="flex">
            <Button
              size="sm"
              variant={props.view === "table" ? "secondary" : "ghost"}
              aria-pressed={props.view === "table"}
              onClick={() => router.push(paths.catalog(clientSlug, viewQuery("table")))}
            >
              <Table2 aria-hidden />
              {t("list.table")}
            </Button>
            <Button
              size="sm"
              variant={props.view === "grid" ? "secondary" : "ghost"}
              aria-pressed={props.view === "grid"}
              onClick={() => router.push(paths.catalog(clientSlug, viewQuery("grid")))}
            >
              <LayoutGrid aria-hidden />
              {t("list.grid")}
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
                aria-label={t("selectItem", { name: r.name })}
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
            <caption className="sr-only">{t("list.caption")}</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={t("list.selectAll")}
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                    }
                    className="size-4"
                  />
                </th>
                <th scope="col" className="px-2 py-3 font-medium">
                  <span className="sr-only">{t("list.thumbnail")}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("list.name")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("list.sku")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("list.category")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("list.status")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("list.completeness")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("list.source")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("list.usedIn")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("list.lastModified")}
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
                      aria-label={t("selectItem", { name: r.name })}
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
                          {t("list.sensitivePending")}
                        </span>
                      ) : null}
                      {r.openProposals ? (
                        <span className="inline-flex items-center gap-1">
                          <GitPullRequest aria-hidden className="size-4" />
                          {t("list.proposals", { count: r.openProposals })}
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
                    {r.byAgent ? t("list.byAgentSource", { source: r.source }) : r.source}
                  </td>
                  <td className="px-4 py-2 text-fg-muted">—</td>
                  <td className="px-4 py-2 text-fg-muted">
                    {shortWhen(t, format, new Date(r.updated))}
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
          aria-label={t("list.pages")}
          className="flex items-center justify-end gap-2 border-t border-subtle px-4 py-3 text-body-sm"
        >
          {props.page > 1 ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={paths.catalog(clientSlug, pageQuery(props.page - 1))}>
                {t("list.previous")}
              </Link>
            </Button>
          ) : null}
          <span className="text-fg-muted">
            {t("list.pageOf", { page: props.page, pages: props.pages })}
          </span>
          {props.page < props.pages ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={paths.catalog(clientSlug, pageQuery(props.page + 1))}>
                {t("list.next")}
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
