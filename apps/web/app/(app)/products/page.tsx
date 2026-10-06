import { products, sql } from "@forgecy/db";
import { asc, clients, getDb, isNull } from "@forgecy/db";
import { Card } from "@forgecy/ui";
import { Package } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { EmptyState } from "./_components/ui";
import { plural } from "./_lib/labels";
import { paths } from "./_lib/paths";

export const metadata = { title: "Prodotti" };

/** Entry from the sidebar: pick the client whose catalog to open (only clients, not prospects). */
export default async function ProductsIndexPage() {
  await requireUser();
  const db = getDb();
  const [rows, counts] = await Promise.all([
    db.select().from(clients).where(isNull(clients.archivedAt)).orderBy(asc(clients.name)),
    db
      .select({
        clientId: products.clientId,
        total: sql<number>`count(*) filter (where ${products.status} <> 'archived')::int`,
        approved: sql<number>`count(*) filter (where ${products.status} = 'approved')::int`,
        proposed: sql<number>`count(*) filter (where ${products.status} = 'proposed')::int`,
      })
      .from(products)
      .groupBy(products.clientId),
  ]);
  const by = new Map(counts.map((c) => [c.clientId, c]));
  const active = rows.filter((c) => c.status === "active");
  const prospects = rows.length - active.length;
  return (
    <>
      <PageHeader
        title="Prodotti"
        description="Il catalogo di ogni cliente: descrizioni, scheda tecnica e foto da riusare nella strategia e nei caroselli."
      />
      <Card className="p-0">
        {active.length === 0 ? (
          <EmptyState icon={Package}>
            Nessun cliente attivo. Il catalogo prodotti è disponibile dopo la conversione in
            cliente.
          </EmptyState>
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
                        ? `${plural(n.total, "prodotto", "prodotti")} · ${n.approved} approvati · ${n.proposed} da rivedere`
                        : "Nessun prodotto"}
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
          {plural(prospects, "prospect non compare", "prospect non compaiono")}: il catalogo si apre
          dopo la conversione in cliente.
        </p>
      ) : null}
    </>
  );
}
