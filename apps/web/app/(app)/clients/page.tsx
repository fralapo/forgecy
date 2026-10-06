import { Badge, Card } from "@forgecy/ui";
import { asc, clients, getDb, isNull } from "@forgecy/db";
import type { Route } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { NewClientForm } from "./new-client-form";

export const metadata = { title: "Clients" };

const statusLabel = { prospect: "Prospect", active: "Active", archived: "Archived" } as const;
const linkClass = "text-link underline-offset-2 hover:underline";

/** Where each client's work lives: the audit for prospects, the three modules for clients. */
function areaLinks(c: { slug: string; status: keyof typeof statusLabel }) {
  if (c.status === "prospect") return [{ label: "Audit", href: `/audit/${c.slug}` }];
  return [
    { label: "Brand", href: `/brand/${c.slug}` },
    { label: "Content", href: `/content/${c.slug}` },
    { label: "Products", href: `/products/${c.slug}` },
  ];
}

const policyLabel = {
  external_allowed: "External AI allowed",
  external_restricted: "External AI restricted",
  local_only: "Local AI only",
  no_ai: "No AI",
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
        title="Clients"
        description="The agency's prospects and clients, each with its own AI policy."
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-body-md text-fg-muted">
              No clients yet. Add the first prospect.
            </p>
          ) : (
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">Client list</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Industry
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    AI policy
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Open
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
                              <span className="sr-only"> for {c.name}</span>
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
          <h2 className="text-heading-sm text-fg">New client</h2>
          <NewClientForm />
        </Card>
      </div>
    </>
  );
}
