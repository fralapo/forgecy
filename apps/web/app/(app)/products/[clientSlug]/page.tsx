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
import { PageHeader } from "@/components/page-header";
import { Banner, Breadcrumb, EmptyState, selectClass } from "../_components/ui";
import { filtersQuery, parseCatalogFilters } from "../_lib/filters";
import { importTitle, plural, productStatusLabels, sourceFilterLabels } from "../_lib/labels";
import { paths } from "../_lib/paths";
import { catalogPage, imageUrl } from "../_lib/server";
import { AddProductButton } from "./add-product";
import { CatalogView, type CatalogViewRow } from "./catalog-view";
import { NotAClient } from "./not-a-client";

export const metadata = { title: "Products" };

type Search = Promise<Record<string, string | string[] | undefined>>;

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
      source: r.source,
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

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Clients", href: "/clients" },
          { label: client.name, href: "/products" },
          { label: "Products" },
        ]}
      />
      <PageHeader
        title="Products"
        description={
          totalProducts
            ? `${plural(totalProducts, "product", "products")} · ${counts.approved ?? 0} approved · ${counts.proposed ?? 0} to review · ${counts.draft ?? 0} drafts`
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <AddProductButton clientId={client.id} clientSlug={client.slug} />
            <Button asChild>
              <Link href={paths.importNew(client.slug)}>
                <FileUp aria-hidden />
                Import products
              </Link>
            </Button>
          </div>
        }
      />
      <div className="mb-6 space-y-3">
        <p className="text-body-sm text-fg-muted">
          <span className="font-medium text-fg">Next action: </span>
          {toReview[0]
            ? `you · Review ${plural(pendingFromImports, "proposed product", "proposed products")} from the ${importTitle(toReview[0].createdAt).replace(/^I/, "i")}`
            : counts.proposed
              ? `you · Approve or reject ${plural(counts.proposed, "proposed product", "proposed products")}`
              : "No pending actions"}
        </p>
        {!ai.available ? <p className="text-body-sm text-fg-muted">{ai.reason}</p> : null}
        {imports.map((imp, i) => {
          const names = importNames[i] || importTitle(imp.createdAt);
          const summary = imp.summary as { found?: number } | null;
          if (imp.status === "analyzing")
            return (
              <Banner
                key={imp.id}
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href={paths.importOpen(client.slug, imp.id)}>Open</Link>
                  </Button>
                }
              >
                Import “{names}” · Analyzing
              </Banner>
            );
          if (imp.status === "needs_mapping")
            return (
              <Banner
                key={imp.id}
                tone="warning"
                action={
                  <Button asChild size="sm">
                    <Link href={paths.importOpen(client.slug, imp.id)}>Complete mapping</Link>
                  </Button>
                }
              >
                Column mapping needed for “{names}”
              </Banner>
            );
          if (imp.status === "ready_for_review")
            return (
              <Banner
                key={imp.id}
                tone="warning"
                action={
                  <Button asChild size="sm">
                    <Link href={paths.review(client.slug, imp.id)}>Review import</Link>
                  </Button>
                }
              >
                {plural(summary?.found ?? 0, "product to review", "products to review")} from the{" "}
                {importTitle(imp.createdAt).replace(/^I/, "i")}
              </Banner>
            );
          return (
            <Banner
              key={imp.id}
              tone="error"
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href={paths.importOpen(client.slug, imp.id)}>Open details</Link>
                </Button>
              }
            >
              Import “{names}” failed
              {imp.failedStep ? ` at step “${imp.failedStep}”` : ""}. (
              {imp.errorCode ?? "IMPORT-FAILED"})
            </Banner>
          );
        })}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-body-sm text-fg-muted">
          Search
          <input
            name="q"
            type="search"
            defaultValue={filters.q ?? ""}
            placeholder="Search by name, SKU or tag"
            className={`${selectClass} w-full`}
          />
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          Status
          <select
            name="status"
            defaultValue={filters.status?.join(",") ?? ""}
            className={selectClass}
          >
            <option value="">All except archived and rejected</option>
            {(["draft", "proposed", "approved", "rejected", "archived"] as const).map((s) => (
              <option key={s} value={s}>
                {productStatusLabels[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          Category
          <select name="category" defaultValue={filters.category ?? ""} className={selectClass}>
            <option value="">All</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          Source
          <select name="source" defaultValue={filters.source ?? ""} className={selectClass}>
            <option value="">All</option>
            {Object.entries(sourceFilterLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          Completeness
          <select
            name="completeness"
            defaultValue={filters.completeness ?? ""}
            className={selectClass}
          >
            <option value="">All</option>
            <option value="complete">Complete</option>
            <option value="partial">Partial</option>
            <option value="minimal">Minimal</option>
          </select>
        </label>
        {filters.importId ? <input type="hidden" name="import" value={filters.importId} /> : null}
        <input type="hidden" name="view" value={filters.view} />
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <Card className="p-0">
        {totalProducts === 0 ? (
          <EmptyState
            icon={Package}
            actions={
              <>
                <Button asChild>
                  <Link href={paths.importNew(client.slug)}>Import products</Link>
                </Button>
                <AddProductButton clientId={client.id} clientSlug={client.slug} />
              </>
            }
          >
            No products for {client.name}. Import a CSV, a ZIP, images or a PDF, or add a product by
            hand.
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={SearchX}
            actions={
              <Button asChild variant="secondary">
                <Link href={paths.catalog(client.slug)}>Clear filters</Link>
              </Button>
            }
          >
            No products match the filters.
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
