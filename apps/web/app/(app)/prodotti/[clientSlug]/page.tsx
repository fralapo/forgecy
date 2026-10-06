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

export const metadata = { title: "Prodotti" };

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
          { label: "Clienti", href: "/clienti" },
          { label: client.name, href: "/prodotti" },
          { label: "Prodotti" },
        ]}
      />
      <PageHeader
        title="Prodotti"
        description={
          totalProducts
            ? `${plural(totalProducts, "prodotto", "prodotti")} · ${counts.approved ?? 0} approvati · ${counts.proposed ?? 0} da rivedere · ${counts.draft ?? 0} bozze`
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <AddProductButton clientId={client.id} clientSlug={client.slug} />
            <Button asChild>
              <Link href={paths.importNew(client.slug)}>
                <FileUp aria-hidden />
                Importa prodotti
              </Link>
            </Button>
          </div>
        }
      />
      <div className="mb-6 space-y-3">
        <p className="text-body-sm text-fg-muted">
          <span className="font-medium text-fg">Prossima azione: </span>
          {toReview[0]
            ? `tu · Rivedi ${plural(pendingFromImports, "prodotto proposto", "prodotti proposti")} dall'${importTitle(toReview[0].createdAt).toLowerCase()}`
            : counts.proposed
              ? `tu · Approva o rifiuta ${plural(counts.proposed, "prodotto proposto", "prodotti proposti")}`
              : "Nessuna azione in sospeso"}
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
                    <Link href={paths.importOpen(client.slug, imp.id)}>Apri</Link>
                  </Button>
                }
              >
                Import «{names}» · Analisi in corso
              </Banner>
            );
          if (imp.status === "needs_mapping")
            return (
              <Banner
                key={imp.id}
                tone="warning"
                action={
                  <Button asChild size="sm">
                    <Link href={paths.importOpen(client.slug, imp.id)}>Completa mappatura</Link>
                  </Button>
                }
              >
                Serve la mappatura delle colonne per «{names}»
              </Banner>
            );
          if (imp.status === "ready_for_review")
            return (
              <Banner
                key={imp.id}
                tone="warning"
                action={
                  <Button asChild size="sm">
                    <Link href={paths.review(client.slug, imp.id)}>Rivedi import</Link>
                  </Button>
                }
              >
                {plural(summary?.found ?? 0, "prodotto da rivedere", "prodotti da rivedere")}{" "}
                dall&apos;{importTitle(imp.createdAt).toLowerCase()}
              </Banner>
            );
          return (
            <Banner
              key={imp.id}
              tone="error"
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href={paths.importOpen(client.slug, imp.id)}>Apri dettagli</Link>
                </Button>
              }
            >
              Import «{names}» non riuscito
              {imp.failedStep ? ` al passo «${imp.failedStep}»` : ""}. (
              {imp.errorCode ?? "IMPORT-FAILED"})
            </Banner>
          );
        })}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-body-sm text-fg-muted">
          Cerca
          <input
            name="q"
            type="search"
            defaultValue={filters.q ?? ""}
            placeholder="Cerca per nome, SKU o tag"
            className={`${selectClass} w-full`}
          />
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          Stato
          <select
            name="status"
            defaultValue={filters.status?.join(",") ?? ""}
            className={selectClass}
          >
            <option value="">Tutti tranne archiviati e rifiutati</option>
            {(["draft", "proposed", "approved", "rejected", "archived"] as const).map((s) => (
              <option key={s} value={s}>
                {productStatusLabels[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          Categoria
          <select name="category" defaultValue={filters.category ?? ""} className={selectClass}>
            <option value="">Tutte</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          Fonte
          <select name="source" defaultValue={filters.source ?? ""} className={selectClass}>
            <option value="">Tutte</option>
            {Object.entries(sourceFilterLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          Completezza
          <select
            name="completeness"
            defaultValue={filters.completeness ?? ""}
            className={selectClass}
          >
            <option value="">Tutte</option>
            <option value="complete">Completo</option>
            <option value="partial">Parziale</option>
            <option value="minimal">Minimo</option>
          </select>
        </label>
        {filters.importId ? <input type="hidden" name="import" value={filters.importId} /> : null}
        <input type="hidden" name="view" value={filters.view} />
        <Button type="submit" variant="secondary">
          Filtra
        </Button>
      </form>

      <Card className="p-0">
        {totalProducts === 0 ? (
          <EmptyState
            icon={Package}
            actions={
              <>
                <Button asChild>
                  <Link href={paths.importNew(client.slug)}>Importa prodotti</Link>
                </Button>
                <AddProductButton clientId={client.id} clientSlug={client.slug} />
              </>
            }
          >
            Nessun prodotto per {client.name}. Importa un CSV, uno ZIP, immagini o un PDF, oppure
            aggiungi un prodotto a mano.
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={SearchX}
            actions={
              <Button asChild variant="secondary">
                <Link href={paths.catalog(client.slug)}>Azzera filtri</Link>
              </Button>
            }
          >
            Nessun prodotto corrisponde ai filtri.
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
