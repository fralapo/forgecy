import {
  emptySectionsByVersion,
  exportableVersions,
  listBrandBookExports,
  publishedBookTemplate,
  SELF_APPROVAL_NOTE_MIN,
} from "@forgecy/brand-book";
import { isLocale, LOCALES } from "@forgecy/core";
import { createStorageFromEnv } from "@forgecy/files";
import { Badge, Card } from "@forgecy/ui";
import { Download, Eye, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { BrandSystemForm } from "../../_components/brand-system-form";
import { ClientBookActions } from "../../_components/client-book-actions";
import { ClientBookForm } from "../../_components/client-book-form";
import { loadBrand, userNames } from "../../_lib/server";

export async function generateMetadata() {
  const t = await getTranslations("brand.meta");
  return { title: t("book") };
}

/** Signed download links last as long as the spec's report links (24 h). */
const LINK_SECONDS = 24 * 3600;

export default async function BrandBookPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const t = await getTranslations("brand");
  const format = await getFormat();
  const { db, user, client } = await loadBrand(clientSlug);
  const [versions, exportsList, templateVersion, locale] = await Promise.all([
    exportableVersions(db, user.actor, client.id),
    listBrandBookExports(db, user.actor, client.id),
    publishedBookTemplate(db),
    getLocale(),
  ]);
  const emptySections = await emptySectionsByVersion(db, user.actor, {
    clientId: client.id,
    clientName: client.name,
    versionIds: versions.map((v) => v.id),
  });
  const names = await userNames(exportsList.flatMap((e) => [e.createdBy, e.approvedBy]));
  const storage = createStorageFromEnv(env);
  const links = new Map(
    await Promise.all(
      exportsList
        .filter((e) => e.storageKey)
        .map(
          async (e) =>
            [
              e.id,
              await storage.signedUrl(e.storageKey!, {
                expiresInSeconds: LINK_SECONDS,
                // Previews (draft or approved) open in the browser; final files download.
                disposition:
                  e.status === "draft" || e.status === "approved" ? "inline" : "attachment",
                ...(e.fileName ? { filename: e.fileName } : {}),
              }),
            ] as const,
        ),
    ),
  );
  const size = (n: number) =>
    t("sources.size", {
      unit: n > 1024 * 1024 ? "mb" : "kb",
      value:
        n > 1024 * 1024
          ? format.number(n / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
          : format.number(Math.ceil(n / 1024)),
    });

  const versionOptions = versions.map((v) => ({
    id: v.id,
    label: t(v.status === "published" ? "book.versionPublished" : "book.versionArchived", {
      number: v.number,
      date: v.publishedAt ? format.date(v.publishedAt, "date") : "—",
    }),
  }));

  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_3fr]">
      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-heading-md text-fg">{t("book.clientTitle")}</h2>
          <p className="mt-1 text-body-sm text-fg-muted">{t("book.clientIntro")}</p>
          <div className="mt-6">
            {!versions.length ? (
              <p className="text-body-md text-fg-muted">{t("book.noPublished")}</p>
            ) : !templateVersion ? (
              <p role="note" className="text-body-md text-fg-muted">
                {t.rich("book.templateMissing", {
                  link: (chunks) => <Link href="/templates">{chunks}</Link>,
                })}
              </p>
            ) : (
              <ClientBookForm
                slug={client.slug}
                clientId={client.id}
                versions={versionOptions.map((v) => ({
                  ...v,
                  empty: emptySections.get(v.id) ?? [],
                }))}
                languages={[...LOCALES]}
                defaultLanguage={isLocale(locale) ? locale : "en"}
              />
            )}
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-md text-fg">{t("book.systemTitle")}</h2>
          <p className="mt-1 text-body-sm text-fg-muted">{t("book.systemIntro")}</p>
          <p
            role="note"
            className="mt-4 flex items-start gap-2 rounded-md border border-warning-fill bg-surface px-3 py-2 text-body-sm text-fg"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            {t("book.internalWarning")}
          </p>
          <div className="mt-6">
            {versions.length ? (
              <BrandSystemForm slug={client.slug} clientId={client.id} versions={versionOptions} />
            ) : (
              <p className="text-body-md text-fg-muted">{t("book.noPublished")}</p>
            )}
          </div>
        </Card>
      </div>
      <Card className="overflow-hidden p-0">
        <h2 className="px-4 pt-4 text-heading-md text-fg">{t("book.historyTitle")}</h2>
        {exportsList.length === 0 ? (
          <p className="p-4 text-body-md text-fg-muted">{t("book.historyEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-left text-body-sm">
              <caption className="sr-only">{t("book.historyTitle")}</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("book.colExport")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("book.colDetails")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">{t("book.download")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {exportsList.map((e) => {
                  const href = links.get(e.id);
                  return (
                    <tr key={e.id} className="border-b border-subtle align-top last:border-0">
                      <td className="px-4 py-3">
                        <span className="text-heading-sm text-fg">
                          {t("book.number", { number: e.number })}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="neutral">{t(`book.type.${e.type}`)}</Badge>
                          <Badge
                            variant={
                              e.status === "exported" || e.status === "approved"
                                ? "success"
                                : "neutral"
                            }
                          >
                            {t(`book.status.${e.status}`)}
                          </Badge>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-fg">
                        {t("book.fromVersion", { number: e.brandVersionNumber })}
                        <span className="block text-fg-muted">
                          {t("book.createdBy", {
                            name: names.get(e.createdBy ?? "") ?? "—",
                            date: format.date(e.createdAt, "dateTime"),
                          })}
                        </span>
                        <span className="block text-fg-muted">
                          {e.type === "client_book" && e.pages
                            ? t("book.pages", { count: e.pages })
                            : t("book.partCount", { count: e.parts.length })}
                          {e.bytes ? ` · ${size(e.bytes)}` : ""}
                        </span>
                        {e.approvedBy && e.approvedAt ? (
                          <span className="block text-fg-muted">
                            {t("book.approvedBy", {
                              name: names.get(e.approvedBy) ?? "—",
                              date: format.date(e.approvedAt, "dateTime"),
                            })}
                          </span>
                        ) : null}
                      </td>
                      <td className="space-y-2 px-4 py-3 text-right">
                        {e.status === "draft" && !href ? (
                          <span className="inline-flex items-center gap-1 text-fg-muted">
                            <LoaderCircle aria-hidden className="size-4" />
                            {t("book.rendering")}
                          </span>
                        ) : null}
                        {href && (e.status === "draft" || e.status === "approved") ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1"
                          >
                            <Eye aria-hidden className="size-4" />
                            {t("book.openPreview")}
                          </a>
                        ) : null}
                        {href && (e.status === "exported" || e.status === "superseded") ? (
                          <a href={href} className="inline-flex items-center gap-1">
                            <Download aria-hidden className="size-4" />
                            {t("book.download")}
                          </a>
                        ) : null}
                        {e.type === "client_book" &&
                        (e.status === "draft" || e.status === "approved") ? (
                          <ClientBookActions
                            slug={client.slug}
                            clientId={client.id}
                            exportId={e.id}
                            status={e.status}
                            rendered={Boolean(e.storageKey)}
                            ownBook={e.createdBy === user.id}
                            noteMin={SELF_APPROVAL_NOTE_MIN}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
