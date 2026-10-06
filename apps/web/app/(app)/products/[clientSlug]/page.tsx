import {
  activeImports,
  categories,
  importFiles,
  listProducts,
  statusCounts,
} from "@forgecy/catalog";
import { getDb } from "@forgecy/db";
import { Button, Card } from "@forgecy/ui";
import { FileUp, Package, SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getFormat, refText } from "@/lib/i18n";
import { Banner, Breadcrumb, EmptyState, selectClass } from "../_components/ui";
import { filtersQuery, parseCatalogFilters } from "../_lib/filters";
import { importTitle, sourceText, stepLabel } from "../_lib/labels";
import { paths } from "../_lib/paths";
import { catalogPage, imageUrl } from "../_lib/server";
import { AddProductButton } from "./add-product";
import { CatalogView, type CatalogViewRow } from "./catalog-view";
import { NotAClient } from "./not-a-client";

export async function generateMetadata() {
  const t = await getTranslations("products");
  return { title: t("title") };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

const sourceFilters = ["csv", "manual", "pdf", "zip", "image"] as const;

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Search;
}) {
  const { clientSlug } = await params;
  const sp = await searchParams;
  const { client, ai } = await catalogPage(clientSlug);
  if (client.status !== "active") return <NotAClient name={client.name} />;
  const t = await getTranslations("products");
  const format = await getFormat();

  const db = getDb();
  const filters = parseCatalogFilters(sp);
  const [list, counts, cats, imports] = await Promise.all([
    listProducts(db, client.id, filters),
    statusCounts(db, client.id),
    categories(db, client.id),
    activeImports(db, client.id),
  ]);
  const importNames = await Promise.all(
    imports.map(async (i) =>
      (await importFiles(db, i.id))
        .filter((f) => !f.parentId)
        .map((f) => f.name)
        .slice(0, 3)
        .join(", "),
    ),
  );
  const rows: CatalogViewRow[] = await Promise.all(
    list.rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      category: r.category,
      status: r.status,
      revision: r.revision,
      byAgent: r.proposedByAgent,
      completeness: r.completeness.level,
      source: r.origin ? sourceText(t, r.origin) : r.source,
      openProposals: r.openProposals,
      sensitivePending: r.sensitivePending,
      updated: r.updatedAt.toISOString(),
      updatedBy: r.updatedByName,
      thumb:
        r.primaryImage?.status === "approved" ? await imageUrl(r.primaryImage.storageKey) : null,
    })),
  );

  const toReview = imports.filter((i) => i.status === "ready_for_review");
  const pendingFromImports = toReview.reduce(
    (n, i) => n + ((i.summary as { found?: number } | null)?.found ?? 0),
    0,
  );
  const totalProducts = counts.total ?? 0;
  const hasFilters = !!filtersQuery(sp, ["view", "page", "sort"]);
  const query = filtersQuery(sp, ["page"]);
  const aiReason = ai.available ? null : await refText(ai.reasonRef, ai.reason ?? "");

  return (
    <>
      <Breadcrumb
        items={[
          { label: t("breadcrumb.clients"), href: "/clients" },
          { label: client.name, href: "/products" },
          { label: t("breadcrumb.products") },
        ]}
      />
      <PageHeader
        title={t("title")}
        description={
          totalProducts
            ? t("catalog.counts", {
                total: totalProducts,
                approved: counts.approved ?? 0,
                proposed: counts.proposed ?? 0,
                draft: counts.draft ?? 0,
              })
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <AddProductButton clientId={client.id} clientSlug={client.slug} />
            <Button asChild>
              <Link href={paths.importNew(client.slug)}>
                <FileUp aria-hidden />
                {t("catalog.importProducts")}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="mb-6 space-y-3">
        <p className="text-body-sm text-fg-muted">
          <span className="font-medium text-fg">{t("nextAction")} </span>
          {toReview[0]
            ? t("catalog.nextReviewImport", {
                count: pendingFromImports,
                date: format.date(toReview[0].createdAt),
              })
            : counts.proposed
              ? t("catalog.nextApprove", { count: counts.proposed })
              : t("noPendingActions")}
        </p>
        {aiReason ? <p className="text-body-sm text-fg-muted">{aiReason}</p> : null}
        {imports.map((imp, i) => {
          const names = importNames[i] || importTitle(t, format, imp.createdAt);
          const summary = imp.summary as { found?: number } | null;
          if (imp.status === "analyzing")
            return (
              <Banner
                key={imp.id}
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href={paths.importOpen(client.slug, imp.id)}>{t("catalog.open")}</Link>
                  </Button>
                }
              >
                {t("catalog.importAnalyzing", { names })}
              </Banner>
            );
          if (imp.status === "needs_mapping")
            return (
              <Banner
                key={imp.id}
                tone="warning"
                action={
                  <Button asChild size="sm">
                    <Link href={paths.importOpen(client.slug, imp.id)}>
                      {t("catalog.completeMapping")}
                    </Link>
                  </Button>
                }
              >
                {t("catalog.mappingNeeded", { names })}
              </Banner>
            );
          if (imp.status === "ready_for_review")
            return (
              <Banner
                key={imp.id}
                tone="warning"
                action={
                  <Button asChild size="sm">
                    <Link href={paths.review(client.slug, imp.id)}>
                      {t("catalog.reviewImport")}
                    </Link>
                  </Button>
                }
              >
                {t("catalog.toReview", {
                  count: summary?.found ?? 0,
                  date: format.date(imp.createdAt),
                })}
              </Banner>
            );
          const code = imp.errorCode ?? "IMPORT-FAILED";
          return (
            <Banner
              key={imp.id}
              tone="error"
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href={paths.importOpen(client.slug, imp.id)}>
                    {t("catalog.openDetails")}
                  </Link>
                </Button>
              }
            >
              {imp.failedStep
                ? t("catalog.importFailedAt", { names, step: stepLabel(t, imp.failedStep), code })
                : t("catalog.importFailed", { names, code })}
            </Banner>
          );
        })}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-body-sm text-fg-muted">
          {t("catalog.search")}
          <input
            name="q"
            type="search"
            defaultValue={filters.q ?? ""}
            placeholder={t("catalog.searchPlaceholder")}
            className={`${selectClass} w-full`}
          />
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          {t("catalog.status")}
          <select
            name="status"
            defaultValue={filters.status?.join(",") ?? ""}
            className={selectClass}
          >
            <option value="">{t("catalog.statusDefault")}</option>
            {(["draft", "proposed", "approved", "rejected", "archived"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          {t("catalog.category")}
          <select name="category" defaultValue={filters.category ?? ""} className={selectClass}>
            <option value="">{t("catalog.all")}</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          {t("catalog.source")}
          <select name="source" defaultValue={filters.source ?? ""} className={selectClass}>
            <option value="">{t("catalog.all")}</option>
            {sourceFilters.map((k) => (
              <option key={k} value={k}>
                {t(`sourceFilter.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          {t("catalog.completeness")}
          <select
            name="completeness"
            defaultValue={filters.completeness ?? ""}
            className={selectClass}
          >
            <option value="">{t("catalog.all")}</option>
            <option value="complete">{t("completeness.complete")}</option>
            <option value="partial">{t("completeness.partial")}</option>
            <option value="minimal">{t("completeness.minimal")}</option>
          </select>
        </label>
        {filters.importId ? <input type="hidden" name="import" value={filters.importId} /> : null}
        <input type="hidden" name="view" value={filters.view} />
        <Button type="submit" variant="secondary">
          {t("catalog.filter")}
        </Button>
      </form>

      <Card className="p-0">
        {totalProducts === 0 ? (
          <EmptyState
            icon={Package}
            actions={
              <>
                <Button asChild>
                  <Link href={paths.importNew(client.slug)}>{t("catalog.importProducts")}</Link>
                </Button>
                <AddProductButton clientId={client.id} clientSlug={client.slug} />
              </>
            }
          >
            {t("catalog.empty", { client: client.name })}
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={SearchX}
            actions={
              <Button asChild variant="secondary">
                <Link href={paths.catalog(client.slug)}>{t("catalog.clearFilters")}</Link>
              </Button>
            }
          >
            {t("catalog.noMatches")}
          </EmptyState>
        ) : (
          <CatalogView
            rows={rows}
            view={filters.view}
            clientId={client.id}
            clientName={client.name}
            clientSlug={client.slug}
            exportHref={paths.exportCsv(client.slug, filtersQuery(sp, ["page", "view"]))}
            query={query}
            page={list.page}
            pages={list.pages}
            total={list.total}
            filtered={hasFilters}
          />
        )}
      </Card>
    </>
  );
}
