import {
  and,
  asc,
  clients,
  clientScopeWhere,
  getDb,
  isNull,
  socialProfiles,
  sql,
} from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { socialPath } from "./_lib/server";

export async function generateMetadata() {
  const t = await getTranslations("social");
  return { title: t("title") };
}

export default async function SocialPickerPage() {
  const user = await requireUser();
  const t = await getTranslations("social");
  const rows = await getDb()
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      profiles: sql<number>`(select count(*)::int from ${socialProfiles}
        where ${socialProfiles.clientId} = ${clients.id})`,
    })
    .from(clients)
    .where(and(isNull(clients.archivedAt), clientScopeWhere(user.actor, clients.id)))
    .orderBy(asc(clients.name));

  // One client: nothing to choose.
  if (rows.length === 1) redirect(socialPath(rows[0]!.slug) as Route);

  return (
    <>
      <PageHeader title={t("title")} description={t("picker.description")} />
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
                href={socialPath(c.slug) as Route}
                className="flex h-full flex-col gap-3 rounded-lg border border-subtle bg-surface p-5 text-fg hover:border-control"
              >
                <span className="text-heading-sm">{c.name}</span>
                <Badge>{t("picker.profiles", { count: c.profiles })}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
