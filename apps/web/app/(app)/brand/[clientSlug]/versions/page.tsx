import { diffVersions, parseDocument, type TokenTree, type VersionRow } from "@forgecy/brand";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { ActionButton } from "../../_components/action-button";
import { DiffList } from "../../_components/diff-list";
import { restoreAction } from "../../actions";
import { brandPath, versionStatusVariant } from "../../_lib/labels";
import { loadBrand, userNames, versionParam } from "../../_lib/server";
import { getFormat } from "@/lib/i18n";

export async function generateMetadata() {
  const t = await getTranslations("brand.meta");
  return { title: t("versions") };
}

const stateOf = (v: VersionRow) => ({
  document: parseDocument(v.document),
  tokens: v.tokens as TokenTree,
});

export default async function VersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const t = await getTranslations("brand");
  const format = await getFormat();
  const when = (d: Date | null) => (d ? format.date(d, "dateTime") : "—");
  const { client, ws } = await loadBrand(clientSlug);
  const names = await userNames(
    ws.versions.flatMap((v) => [v.publishedBy, v.createdBy, v.approvedBy]),
  );
  const viewNumber = versionParam(sp.view);
  const viewed = viewNumber ? ws.versions.find((v) => v.number === viewNumber) : undefined;
  const previous = viewed
    ? ws.versions.find(
        (v) =>
          v.number < viewed.number &&
          (v.status === "published" || v.status === "archived") &&
          v.publishedAt,
      )
    : undefined;
  const base = brandPath(client.slug);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Card className="overflow-hidden p-0">
        {ws.versions.length === 0 ? (
          <p className="p-6 text-body-md text-fg-muted">{t("versions.empty")}</p>
        ) : (
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">{t("versions.caption")}</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("versions.version")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("versions.changelog")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">{t("versions.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ws.versions.map((v) => (
                <tr key={v.id} className="border-b border-subtle align-top last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`${base}/versions?view=${v.number}` as Route}
                      className="text-heading-sm"
                    >
                      {t("versions.number", { number: v.number })}
                    </Link>
                    <span className="mt-1 block">
                      <Badge variant={versionStatusVariant[v.status]}>
                        {v.status === "published"
                          ? t("versions.current", { status: t(`versionStatus.${v.status}`) })
                          : t(`versionStatus.${v.status}`)}
                      </Badge>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fg">
                    {v.changelog ?? <span className="text-fg-muted">—</span>}
                    <span className="block text-fg-muted">
                      {v.publishedAt
                        ? t("versions.publishedBy", {
                            name: names.get(v.publishedBy ?? "") ?? "—",
                            date: when(v.publishedAt),
                          })
                        : t("versions.createdBy", {
                            name: names.get(v.createdBy ?? "") ?? "—",
                            date: when(v.createdAt),
                          })}
                      {v.restoredFromVersionId
                        ? ` · ${t("versions.restoredFrom", {
                            number:
                              ws.versions.find((x) => x.id === v.restoredFromVersionId)?.number ??
                              "?",
                          })}`
                        : ""}
                    </span>
                    {v.approvalNote ? (
                      <span className="block text-fg-muted">
                        {t("versions.note", { note: v.approvalNote })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.status === "published" || v.status === "archived" ? (
                      <ActionButton
                        variant="secondary"
                        size="sm"
                        confirm={
                          ws.draft
                            ? t("versions.replaceConfirm", {
                                draft: ws.draft.number,
                                number: v.number,
                              })
                            : t("versions.restoreConfirm", { number: v.number })
                        }
                        action={restoreAction.bind(null, {
                          slug: client.slug,
                          clientId: client.id,
                          versionId: v.id,
                          replaceDraft: !!ws.draft,
                        })}
                        redirectTo={`${base}/versions`}
                      >
                        {t("versions.restore")}
                      </ActionButton>
                    ) : (
                      <Link href={`${base}/versions/${v.number}/approve` as Route}>
                        {t("versions.openApproval")}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {viewed ? (
        <Card className="p-6">
          <h2 className="text-heading-md text-fg">
            {previous
              ? t("versions.comparedWith", { number: viewed.number, previous: previous.number })
              : t("versions.firstVersion", { number: viewed.number })}
          </h2>
          <p className="mt-1 text-body-sm text-fg-muted">
            {t.rich("versions.openReadOnly", {
              strategy: (chunks) => (
                <Link href={`${base}/strategy?version=${viewed.number}` as Route}>{chunks}</Link>
              ),
              verbal: (chunks) => (
                <Link href={`${base}/verbal?version=${viewed.number}` as Route}>{chunks}</Link>
              ),
              visual: (chunks) => (
                <Link href={`${base}/visual?version=${viewed.number}` as Route}>{chunks}</Link>
              ),
              content: (chunks) => (
                <Link href={`${base}/content?version=${viewed.number}` as Route}>{chunks}</Link>
              ),
            })}
          </p>
          <div className="mt-4">
            <DiffList
              changes={diffVersions(previous ? stateOf(previous) : null, stateOf(viewed))}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
