import { diffVersions, parseDocument, type TokenTree, type VersionRow } from "@forgecy/brand";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { ActionButton } from "../../_components/action-button";
import { DiffList } from "../../_components/diff-list";
import { restoreAction } from "../../actions";
import { brandPath, formatDate, versionStatusLabel, versionStatusVariant } from "../../_lib/labels";
import { loadBrand, userNames, versionParam } from "../../_lib/server";

export const metadata = { title: "Versioni · Brand Identity" };

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
          <p className="p-6 text-body-md text-fg-muted">Ancora nessuna versione.</p>
        ) : (
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">Cronologia delle versioni</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Versione
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Changelog
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Azioni</span>
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
                        {v.status === "published" ? " · Corrente" : ""}
                      </Badge>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fg">
                    {v.changelog ?? <span className="text-fg-muted">—</span>}
                    <span className="block text-fg-muted">
                      {v.publishedAt
                        ? `Pubblicata da ${names.get(v.publishedBy ?? "") ?? "—"}, ${formatDate(v.publishedAt)}`
                        : `Creata da ${names.get(v.createdBy ?? "") ?? "—"}, ${formatDate(v.createdAt)}`}
                      {v.restoredFromVersionId
                        ? ` · ripristino della v${ws.versions.find((x) => x.id === v.restoredFromVersionId)?.number ?? "?"}`
                        : ""}
                    </span>
                    {v.approvalNote ? (
                      <span className="block text-fg-muted">Nota: {v.approvalNote}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.status === "published" || v.status === "archived" ? (
                      <ActionButton
                        variant="secondary"
                        size="sm"
                        confirm={
                          ws.draft
                            ? `Esiste già la bozza v${ws.draft.number}: verrà archiviata e sostituita da una copia della v${v.number}. Continuare?`
                            : `Creare una nuova bozza con il contenuto della v${v.number}? La cronologia non cambia.`
                        }
                        action={restoreAction.bind(null, {
                          slug: client.slug,
                          clientId: client.id,
                          versionId: v.id,
                          replaceDraft: !!ws.draft,
                        })}
                        redirectTo={`${base}/versions`}
                      >
                        Ripristina come bozza
                      </ActionButton>
                    ) : (
                      <Link href={`${base}/versions/${v.number}/approve` as Route}>
                        Apri approvazione
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
            v{viewed.number} {previous ? `rispetto alla v${previous.number}` : "· prima versione"}
          </h2>
          <p className="mt-1 text-body-sm text-fg-muted">
            Apri i blocchi in sola lettura:{" "}
            <Link href={`${base}/strategy?version=${viewed.number}` as Route}>Strategia</Link>,{" "}
            <Link href={`${base}/verbal?version=${viewed.number}` as Route}>Verbale</Link>,{" "}
            <Link href={`${base}/visual?version=${viewed.number}` as Route}>Visual</Link>,{" "}
            <Link href={`${base}/content?version=${viewed.number}` as Route}>Contenuti</Link>.
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
