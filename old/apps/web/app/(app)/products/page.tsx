import { products, sql } from "@forgecy/db";
import { and, asc, clients, clientScopeWhere, getDb, isNull } from "@forgecy/db";
import { Card } from "@forgecy/ui";
import { Package } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { EmptyState } from "./_components/ui";
import { paths } from "./_lib/paths";

export async function generateMetadata() {
  const t = await getTranslations("products");
  return { title: t("title") };
}

/** Entry from the sidebar: pick the client whose catalog to open (only clients, not prospects). */
export default async function ProductsIndexPage() {
  const user = await requireUser();
  const t = await getTranslations("products");
  const db = getDb();
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(clients)
      .where(and(isNull(clients.archivedAt), clientScopeWhere(user.actor, clients.id)))
      .orderBy(asc(clients.name)),
    db
      .select({
        clientId: products.clientId,
        total: sql<number>`count(*) filter (where ${products.status} <> 'archived')::int`,
        approved: sql<number>`count(*) filter (where ${products.status} = 'approved')::int`,
        proposed: sql<number>`count(*) filter (where ${products.status} = 'proposed')::int`,
      })
      .from(products)
      .where(clientScopeWhere(user.actor, products.clientId))
      .groupBy(products.clientId),
  ]);
  const by = new Map(counts.map((c) => [c.clientId, c]));
  const active = rows.filter((c) => c.status === "active");
  const prospects = rows.length - active.length;
  return (
    <>
      <PageHeader title={t("title")} description={t("index.description")} />
      <Card className="p-0">
        {active.length === 0 ? (
          <EmptyState icon={Package}>{t("index.noClients")}</EmptyState>
        ) : (
          <ul className="divide-y divide-subtle">
            {active.map((c) => {
              const n = by.get(c.id);
              return (
                <li key={c.id}>
                  <Link
                    href={paths.catalog(c.slug)}
                    className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-app focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span className="text-body-md text-fg">{c.name}</span>
                    <span className="text-body-sm text-fg-muted">
                      {n?.total
                        ? t("index.counts", {
                            total: n.total,
                            approved: n.approved,
                            proposed: n.proposed,
                          })
                        : t("index.noProducts")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {prospects > 0 ? (
        <p className="mt-4 text-body-sm text-fg-muted">
          {t("index.prospectsHidden", { count: prospects })}
        </p>
      ) : null}
    </>
  );
}
