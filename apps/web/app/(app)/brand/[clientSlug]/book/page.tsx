import { exportableVersions, listBrandBookExports } from "@forgecy/brand-book";
import { createStorageFromEnv } from "@forgecy/files";
import { Badge, Card } from "@forgecy/ui";
import { Download, TriangleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { BrandSystemForm } from "../../_components/brand-system-form";
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
  const [versions, exportsList] = await Promise.all([
    exportableVersions(db, user.actor, client.id),
    listBrandBookExports(db, user.actor, client.id),
  ]);
  const names = await userNames(exportsList.map((e) => e.createdBy));
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
                disposition: "attachment",
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

  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_3fr]">
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
            <BrandSystemForm
              slug={client.slug}
              clientId={client.id}
              versions={versions.map((v) => ({
                id: v.id,
                label: t(
                  v.status === "published" ? "book.versionPublished" : "book.versionArchived",
                  {
                    number: v.number,
                    date: v.publishedAt ? format.date(v.publishedAt, "date") : "—",
                  },
                ),
              }))}
            />
          ) : (
            <p className="text-body-md text-fg-muted">{t("book.noPublished")}</p>
          )}
        </div>
      </Card>
      <Card className="overflow-hidden p-0">
        <h2 className="px-4 pt-4 text-heading-md text-fg">{t("book.historyTitle")}</h2>
        {exportsList.length === 0 ? (
          <p className="p-4 text-body-md text-fg-muted">{t("book.historyEmpty")}</p>
        ) : (
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
                        <Badge variant={e.status === "exported" ? "success" : "neutral"}>
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
                        {t("book.partCount", { count: e.parts.length })}
                        {e.bytes ? ` · ${size(e.bytes)}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {href ? (
                        <a href={href} className="inline-flex items-center gap-1">
                          <Download aria-hidden className="size-4" />
                          {t("book.download")}
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
