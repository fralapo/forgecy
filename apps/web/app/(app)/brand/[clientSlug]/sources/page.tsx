import { createStorageFromEnv } from "@forgecy/files";
import { Badge, Card } from "@forgecy/ui";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getFormat, getRefText } from "@/lib/i18n";
import { ActionButton } from "../../_components/action-button";
import { LinkSourceForm, UploadSourceForm } from "../../_components/source-forms";
import { crawlSourceAction, importSourceAction, removeSourceAction, scanWebsiteAction } from "../../actions";
import { sourceStatusVariant } from "../../_lib/labels";
import { loadBrand, sourcesFor } from "../../_lib/server";

export async function generateMetadata() {
  const t = await getTranslations("brand.meta");
  return { title: t("sources") };
}

export default async function SourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const t = await getTranslations("brand");
  const format = await getFormat();
  const rt = await getRefText();
  const size = (n: number) =>
    n > 1024 * 1024
      ? t("sources.size", {
          unit: "mb",
          value: format.number(n / 1024 / 1024, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
        })
      : t("sources.size", { unit: "kb", value: format.number(Math.ceil(n / 1024)) });
  const { client } = await loadBrand(clientSlug);
  const sources = await sourcesFor(client.id);
  const storage = createStorageFromEnv(env);
  // Files are offered as downloads only: an SVG opened inline could run scripts.
  const links = new Map(
    await Promise.all(
      sources
        .filter((s) => s.storageKey)
        .map(
          async (s) =>
            [
              s.id,
              await storage.signedUrl(s.storageKey!, {
                expiresInSeconds: 600,
                disposition: "attachment",
                filename: s.title,
              }),
            ] as const,
        ),
    ),
  );
  const noAi = client.aiPolicy === "no_ai";
  const hasWebsiteSource = sources.some((s) => s.kind === "website");
  const showScanBanner = Boolean(client.websiteUrl) && !hasWebsiteSource;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      {showScanBanner ? (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-6 xl:col-span-2">
          <p className="text-body-sm text-fg">{t("sources.notScannedYet")}</p>
          <ActionButton
            variant="primary"
            size="sm"
            action={scanWebsiteAction.bind(null, {
              slug: client.slug,
              clientId: client.id,
              websiteUrl: client.websiteUrl!,
            })}
          >
            {t("sources.runScan")}
          </ActionButton>
        </Card>
      ) : null}
      <Card className="overflow-hidden p-0">
        {sources.length === 0 ? (
          <p className="p-6 text-body-md text-fg-muted">{t("sources.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">{t("sources.caption")}</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("sources.source")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("sources.status")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("sources.added")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">{t("sources.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="border-b border-subtle align-top last:border-0">
                    <td className="px-4 py-3 text-fg">
                      {links.get(s.id) ? (
                        <a href={links.get(s.id)}>{s.title}</a>
                      ) : s.url ? (
                        <a href={s.url} rel="noreferrer noopener" target="_blank">
                          {s.title}
                        </a>
                      ) : (
                        s.title
                      )}
                      <span className="block text-fg-muted">
                        {t(`sourceKind.${s.kind}`)}
                        {s.size ? ` · ${size(s.size)}` : ""}
                        {s.pageCount ? ` · ${t("sources.partsRead", { count: s.pageCount })}` : ""}
                      </span>
                      {s.statusDetail ? (
                        <span className="block text-fg-muted">
                          {s.statusDetailRef?.length
                            ? s.statusDetailRef.map((r) => rt(r, "")).join(" · ")
                            : s.statusDetail}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={sourceStatusVariant[s.status]}>
                        {t(`sourceStatus.${s.status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {s.capturedAt ? format.date(s.capturedAt, "dateTime") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {s.storageKey && s.status !== "pending" && s.status !== "extracting" ? (
                          <ActionButton
                            variant="secondary"
                            size="sm"
                            action={importSourceAction.bind(null, {
                              slug: client.slug,
                              clientId: client.id,
                              sourceId: s.id,
                            })}
                          >
                            {t("sources.readAgain")}
                          </ActionButton>
                        ) : null}
                        {s.kind === "website" && s.status !== "extracting" ? (
                          <ActionButton
                            variant="secondary"
                            size="sm"
                            action={crawlSourceAction.bind(null, {
                              slug: client.slug,
                              clientId: client.id,
                              sourceId: s.id,
                            })}
                          >
                            {s.status === "pending" ? t("sources.runScan") : t("sources.scanAgain")}
                          </ActionButton>
                        ) : null}
                        <ActionButton
                          variant="ghost"
                          size="sm"
                          confirm={t("sources.removeConfirm")}
                          action={removeSourceAction.bind(null, {
                            slug: client.slug,
                            clientId: client.id,
                            sourceId: s.id,
                          })}
                        >
                          {t("sources.remove")}
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("sources.importTitle")}</h2>
          <p className="mt-1 text-body-sm text-fg-muted">
            {noAi ? t("sources.importNoAi") : t("sources.importAi")}
          </p>
          <div className="mt-4">
            <UploadSourceForm slug={client.slug} open={sp.import === "1"} />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("sources.linkTitle")}</h2>
          <div className="mt-4">
            <LinkSourceForm slug={client.slug} clientId={client.id} />
          </div>
        </Card>
      </div>
    </div>
  );
}
