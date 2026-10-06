import { diffVersions, parseDocument, type TokenTree, type VersionRow } from "@forgecy/brand";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { ActionButton } from "../../_components/action-button";
import { DiffList } from "../../_components/diff-list";
import { restoreAction } from "../../actions";
import { brandPath, formatDate, versionStatusLabel, versionStatusVariant } from "../../_lib/labels";
import { loadBrand, userNames, versionParam } from "../../_lib/server";

export const metadata = { title: "Versions · Brand Identity" };

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
          <p className="p-6 text-body-md text-fg-muted">No versions yet.</p>
        ) : (
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">Version history</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Version
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Changelog
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
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
                      v{v.number}
                    </Link>
                    <span className="mt-1 block">
                      <Badge variant={versionStatusVariant[v.status]}>
                        {versionStatusLabel[v.status]}
                        {v.status === "published" ? " · Current" : ""}
                      </Badge>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fg">
                    {v.changelog ?? <span className="text-fg-muted">—</span>}
                    <span className="block text-fg-muted">
                      {v.publishedAt
                        ? `Published by ${names.get(v.publishedBy ?? "") ?? "—"}, ${formatDate(v.publishedAt)}`
                        : `Created by ${names.get(v.createdBy ?? "") ?? "—"}, ${formatDate(v.createdAt)}`}
                      {v.restoredFromVersionId
                        ? ` · restored from v${ws.versions.find((x) => x.id === v.restoredFromVersionId)?.number ?? "?"}`
                        : ""}
                    </span>
                    {v.approvalNote ? (
                      <span className="block text-fg-muted">Note: {v.approvalNote}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.status === "published" || v.status === "archived" ? (
                      <ActionButton
                        variant="secondary"
                        size="sm"
                        confirm={
                          ws.draft
                            ? `Draft v${ws.draft.number} already exists: it will be archived and replaced by a copy of v${v.number}. Continue?`
                            : `Create a new draft with the content of v${v.number}? The history doesn’t change.`
                        }
                        action={restoreAction.bind(null, {
                          slug: client.slug,
                          clientId: client.id,
                          versionId: v.id,
                          replaceDraft: !!ws.draft,
                        })}
                        redirectTo={`${base}/versions`}
                      >
                        Restore as draft
                      </ActionButton>
                    ) : (
                      <Link href={`${base}/versions/${v.number}/approve` as Route}>
                        Open approval
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
            v{viewed.number} {previous ? `compared with v${previous.number}` : "· first version"}
          </h2>
          <p className="mt-1 text-body-sm text-fg-muted">
            Open the blocks read-only:{" "}
            <Link href={`${base}/strategy?version=${viewed.number}` as Route}>Strategy</Link>,{" "}
            <Link href={`${base}/verbal?version=${viewed.number}` as Route}>Verbal</Link>,{" "}
            <Link href={`${base}/visual?version=${viewed.number}` as Route}>Visual</Link>,{" "}
            <Link href={`${base}/content?version=${viewed.number}` as Route}>Content</Link>.
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
