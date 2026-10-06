import { getPublishedBrandIdentity } from "@forgecy/brand";
import { Badge } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ContentTabs } from "../_components/content-tabs";
import { carouselsPath, contentPath, libraryPath, planPath } from "../_lib/paths";
import { loadClient } from "../_lib/server";

export default async function ContentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { db, user, client } = await loadClient(clientSlug);
  const brand = await getPublishedBrandIdentity(db, user.actor, client.id);
  const t = await getTranslations("content.client");
  const tabs = [
    { href: contentPath(client.slug), label: t("tabs.strategy") },
    { href: planPath(client.slug), label: t("tabs.plan") },
    { href: carouselsPath(client.slug), label: t("tabs.carousels") },
    { href: libraryPath(client.slug), label: t("tabs.library") },
  ];
  return (
    <>
      <header className="mb-6">
        <p className="text-body-sm text-fg-muted">
          <Link href="/content">{t("breadcrumb")}</Link> › {client.name}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-heading-lg text-fg">
            {t("heading", { client: client.name })}
          </h1>
          {brand ? (
            <Badge variant="success">{t("brandVersion", { number: brand.number })}</Badge>
          ) : (
            <Badge variant="warning">{t("brandMissing")}</Badge>
          )}
        </div>
      </header>
      <ContentTabs tabs={tabs} />
      {!brand ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-warning-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          {t("brandRequired")} <Link href={`/brand/${client.slug}` as Route}>{t("openBrand")}</Link>
        </p>
      ) : null}
      {children}
    </>
  );
}
