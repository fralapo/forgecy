import {
  compareVersions,
  diffVersions,
  parseDocument,
  type TokenTree,
  type VersionRow,
} from "@forgecy/brand";
import { Badge, Button, Card } from "@forgecy/ui";
import { Columns2 } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { ActionButton } from "../../_components/action-button";
import { DiffList } from "../../_components/diff-list";
import { VersionCompare } from "../../_components/version-compare";
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
  const pair = compareParam(sp);
  const compared = pair
    ? ([pair[0], pair[1]].map((n) => ws.versions.find((v) => v.number === n)) as [
        VersionRow | undefined,
        VersionRow | undefined,
      ])
    : null;
  const comparable = ws.versions.length > 1;

  const picker = comparable ? (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-body-sm text-fg-muted">
        {t("versions.compareFrom")}
        <select
          name="from"
          defaultValue={pair?.[0] ?? ws.versions[1]?.number}
          className={selectClass}
        >
          {ws.versions.map((v) => (
            <option key={v.id} value={v.number}>
              {t("versions.number", { number: v.number })}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-body-sm text-fg-muted">
        {t("versions.compareTo")}
        <select
          name="to"
          defaultValue={pair?.[1] ?? ws.versions[0]?.number}
          className={selectClass}
        >
          {ws.versions.map((v) => (
            <option key={v.id} value={v.number}>
              {t("versions.number", { number: v.number })}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary" size="sm">
        <Columns2 aria-hidden />
        {t("versions.compare")}
      </Button>
      {pair ? (
        <Link href={`${base}/versions` as Route} className="text-body-sm">
          {t("versions.backToVersions")}
        </Link>
      ) : null}
    </form>
  ) : null;

  if (pair) {
    const [l, r] = compared!;
    const missing = !l ? pair[0] : !r ? pair[1] : null;
    return (
      <div className="grid gap-6">
        {picker}
        {missing !== null ? (
          <p role="alert" className="text-body-md text-error">
            {t("versions.compareMissing", { number: missing })}
          </p>
        ) : pair[0] === pair[1] ? (
          <p role="alert" className="text-body-md text-fg-muted">
            {t("versions.compareSame")}
          </p>
        ) : (
          <VersionCompare
            rows={compareVersions(stateOf(l!), stateOf(r!))}
            left={pair[0]}
            right={pair[1]}
            all={sp.all === "1"}
            href={`${base}/versions?compare=${pair[0]}..${pair[1]}`}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {picker}
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="overflow-hidden p-0">
          {ws.versions.length === 0 ? (
            <p className="p-6 text-body-md text-fg-muted">{t("versions.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
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
                                  ws.versions.find((x) => x.id === v.restoredFromVersionId)
                                    ?.number ?? "?",
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
            </div>
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
            {previous ? (
              <p className="mt-1 text-body-sm">
                <Link
                  href={`${base}/versions?compare=${previous.number}..${viewed.number}` as Route}
                >
                  {t("versions.compareSideBySide", { previous: previous.number })}
                </Link>
              </p>
            ) : null}
            <div className="mt-4">
              <DiffList
                changes={diffVersions(previous ? stateOf(previous) : null, stateOf(viewed))}
              />
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/** Same look as the shared form controls; kept here because those live in client modules. */
const selectClass =
  "rounded-md border border-control bg-surface px-3 py-2 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** `?compare=3..4`, or `?from=3&to=4` from the picker; older version on the left. */
function compareParam(sp: Record<string, string | string[] | undefined>): [number, number] | null {
  const raw = Array.isArray(sp.compare) ? sp.compare[0] : sp.compare;
  const m = raw?.match(/^(\d+)\.\.(\d+)$/);
  const a = m ? Number(m[1]) : versionParam(sp.from);
  const b = m ? Number(m[2]) : versionParam(sp.to);
  if (!a || !b) return null;
  return a <= b ? [a, b] : [b, a];
}
