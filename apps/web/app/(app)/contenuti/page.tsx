import { asc, clients, contents, getDb, isNull, sql } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { contentPath } from "./_lib/paths";

export const metadata = { title: "Contenuti" };

export default async function ContentPickerPage() {
  await requireUser();
  const db = getDb();
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      inReview: sql<number>`(select count(*)::int from ${contents}
        where ${contents.clientId} = ${clients.id} and ${contents.status} = 'in_review')`,
      drafts: sql<number>`(select count(*)::int from ${contents}
        where ${contents.clientId} = ${clients.id} and ${contents.status} in ('draft', 'changes_requested'))`,
    })
    .from(clients)
    .where(isNull(clients.archivedAt))
    .orderBy(asc(clients.name));

  return (
    <>
      <PageHeader
        title="Contenuti"
        description="Strategia editoriale, piano a 30 giorni e caroselli di ogni cliente."
      />
      {rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">
            Nessun cliente. <Link href="/clienti">Aggiungi il primo cliente</Link>.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={contentPath(c.slug) as Route}
                className="flex h-full flex-col gap-3 rounded-lg border border-subtle bg-surface p-5 text-fg hover:border-control"
              >
                <span className="text-heading-sm">{c.name}</span>
                <span className="flex flex-wrap gap-2">
                  {c.inReview ? <Badge variant="warning">{c.inReview} in revisione</Badge> : null}
                  {c.drafts ? <Badge variant="info">{c.drafts} in lavorazione</Badge> : null}
                  {!c.inReview && !c.drafts ? <Badge>Nessun carosello aperto</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
