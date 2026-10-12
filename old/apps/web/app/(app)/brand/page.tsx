import {
  and,
  brandIdentityVersions,
  asc,
  clients,
  clientScopeWhere,
  getDb,
  isNull,
  sql,
} from "@forgecy/db";
import { can } from "@forgecy/core";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { AddBrand } from "./_components/add-brand";
import { brandPath } from "./_lib/labels";

export async function generateMetadata() {
  const t = await getTranslations("brand");
  return { title: t("title") };
}

export default async function BrandPickerPage() {
  const user = await requireUser();
  const t = await getTranslations("brand");
  const db = getDb();
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      published: sql<
        number | null
      >`(select max(${brandIdentityVersions.number}) from ${brandIdentityVersions}
        where ${brandIdentityVersions.clientId} = ${clients.id} and ${brandIdentityVersions.status} = 'published')`,
      draft: sql<
        number | null
      >`(select max(${brandIdentityVersions.number}) from ${brandIdentityVersions}
        where ${brandIdentityVersions.clientId} = ${clients.id} and ${brandIdentityVersions.status} in ('draft', 'in_review'))`,
    })
    .from(clients)
    .where(and(isNull(clients.archivedAt), clientScopeWhere(user.actor, clients.id)))
    .orderBy(asc(clients.name));

  return (
    <>
      <PageHeader title={t("title")} description={t("picker.description")} />
      {can(user.actor, "project.edit") ? <AddBrand /> : null}
      {rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">
            {t.rich("picker.empty", {
              link: (chunks) => <Link href="/clients">{chunks}</Link>,
            })}
          </p>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={brandPath(c.slug) as Route}
                className="flex h-full flex-col gap-3 rounded-lg border border-subtle bg-surface p-5 text-fg hover:border-control"
              >
                <span className="text-heading-sm">{c.name}</span>
                <span className="flex flex-wrap gap-2">
                  {c.published ? (
                    <Badge variant="success">
                      {t("picker.published", { number: c.published })}
                    </Badge>
                  ) : (
                    <Badge>{t("picker.noPublished")}</Badge>
                  )}
                  {c.draft ? (
                    <Badge variant="info">{t("picker.draft", { number: c.draft })}</Badge>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
