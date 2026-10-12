import { and, asc, clients, clientScopeWhere, contents, getDb, isNull, sql } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { contentPath } from "./_lib/paths";

export async function generateMetadata() {
  const t = await getTranslations("content");
  return { title: t("title") };
}

export default async function ContentPickerPage() {
  const user = await requireUser();
  const t = await getTranslations("content");
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
    .where(and(isNull(clients.archivedAt), clientScopeWhere(user.actor, clients.id)))
    .orderBy(asc(clients.name));

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
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
                href={contentPath(c.slug) as Route}
                className="flex h-full flex-col gap-3 rounded-lg border border-subtle bg-surface p-5 text-fg hover:border-control"
              >
                <span className="text-heading-sm">{c.name}</span>
                <span className="flex flex-wrap gap-2">
                  {c.inReview ? (
                    <Badge variant="warning">{t("picker.inReview", { count: c.inReview })}</Badge>
                  ) : null}
                  {c.drafts ? (
                    <Badge variant="info">{t("picker.inProgress", { count: c.drafts })}</Badge>
                  ) : null}
                  {!c.inReview && !c.drafts ? <Badge>{t("picker.noneOpen")}</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
