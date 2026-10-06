import { Badge, Card } from "@forgecy/ui";
import { asc, clients, getDb, isNull } from "@forgecy/db";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { NewClientForm } from "./new-client-form";

export async function generateMetadata() {
  const t = await getTranslations("clients");
  return { title: t("title") };
}

const linkClass = "text-link underline-offset-2 hover:underline";

/** Where each client's work lives: the audit for prospects, the three modules for clients. */
function areaLinks(c: { slug: string; status: string }) {
  if (c.status === "prospect") return [{ label: "audit", href: `/audit/${c.slug}` }] as const;
  return [
    { label: "brand", href: `/brand/${c.slug}` },
    { label: "content", href: `/content/${c.slug}` },
    { label: "products", href: `/products/${c.slug}` },
  ] as const;
}

export default async function ClientsPage() {
  await requireUser();
  const t = await getTranslations("clients");
  const te = await getTranslations("enums");
  const rows = await getDb()
    .select()
    .from(clients)
    .where(isNull(clients.archivedAt))
    .orderBy(asc(clients.name));
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-body-md text-fg-muted">{t("empty")}</p>
          ) : (
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">{t("table.caption")}</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("table.name")}
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("table.status")}
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("table.industry")}
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("table.aiPolicy")}
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("table.open")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-subtle last:border-0">
                    <td className="px-6 py-3 text-fg">
                      <Link href={`/clients/${c.slug}` as Route} className={linkClass}>
                        {c.name}
                      </Link>
                      {c.websiteUrl ? (
                        <span className="block text-fg-muted">{c.websiteUrl}</span>
                      ) : null}
                    </td>
                    <td className="px-6 py-3">
                      <Badge>{te(`clientStatus.${c.status}`)}</Badge>
                    </td>
                    <td className="px-6 py-3 text-fg-muted">{c.sector ?? "—"}</td>
                    <td className="px-6 py-3 text-fg-muted">{te(`aiPolicy.${c.aiPolicy}`)}</td>
                    <td className="px-6 py-3">
                      <ul className="flex flex-wrap gap-x-3 gap-y-1">
                        {areaLinks(c).map((l) => (
                          <li key={l.label}>
                            <Link href={l.href as Route} className={linkClass}>
                              {t(`areas.${l.label}`)}{" "}
                              <span className="sr-only">{t("areaFor", { client: c.name })}</span>
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
          <h2 className="text-heading-sm text-fg">{t("new.title")}</h2>
          <NewClientForm />
        </Card>
      </div>
    </>
  );
}
