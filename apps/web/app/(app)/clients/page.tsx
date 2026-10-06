import { Badge, Card } from "@forgecy/ui";
import { asc, clients, getDb, isNull } from "@forgecy/db";
import type { Route } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { NewClientForm } from "./new-client-form";

export const metadata = { title: "Clienti" };

const statusLabel = { prospect: "Prospect", active: "Attivo", archived: "Archiviato" } as const;
const linkClass = "text-link underline-offset-2 hover:underline";

/** Where each client's work lives: the audit for prospects, the three modules for clients. */
function areaLinks(c: { slug: string; status: keyof typeof statusLabel }) {
  if (c.status === "prospect") return [{ label: "Audit", href: `/audit/${c.slug}` }];
  return [
    { label: "Brand", href: `/brand/${c.slug}` },
    { label: "Contenuti", href: `/content/${c.slug}` },
    { label: "Prodotti", href: `/products/${c.slug}` },
  ];
}

const policyLabel = {
  external_allowed: "AI esterna ammessa",
  external_restricted: "AI esterna limitata",
  local_only: "Solo AI locale",
  no_ai: "Nessuna AI",
} as const;

export default async function ClientsPage() {
  await requireUser();
  const rows = await getDb()
    .select()
    .from(clients)
    .where(isNull(clients.archivedAt))
    .orderBy(asc(clients.name));
  return (
    <>
      <PageHeader
        title="Clienti"
        description="Prospect e clienti dell'agenzia, ognuno con la sua policy AI."
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-body-md text-fg-muted">
              Nessun cliente. Aggiungi il primo prospect.
            </p>
          ) : (
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">Elenco clienti</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Nome
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Stato
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Settore
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Policy AI
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Apri
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-subtle last:border-0">
                    <td className="px-6 py-3 text-fg">
                      {c.name}
                      {c.websiteUrl ? (
                        <span className="block text-fg-muted">{c.websiteUrl}</span>
                      ) : null}
                    </td>
                    <td className="px-6 py-3">
                      <Badge>{statusLabel[c.status]}</Badge>
                    </td>
                    <td className="px-6 py-3 text-fg-muted">{c.sector ?? "—"}</td>
                    <td className="px-6 py-3 text-fg-muted">{policyLabel[c.aiPolicy]}</td>
                    <td className="px-6 py-3">
                      <ul className="flex flex-wrap gap-x-3 gap-y-1">
                        {areaLinks(c).map((l) => (
                          <li key={l.label}>
                            <Link href={l.href as Route} className={linkClass}>
                              {l.label}
                              <span className="sr-only"> di {c.name}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">Nuovo cliente</h2>
          <NewClientForm />
        </Card>
      </div>
    </>
  );
}
