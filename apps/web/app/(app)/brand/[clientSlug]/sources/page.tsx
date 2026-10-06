import { createStorageFromEnv } from "@forgecy/files";
import { Badge, Card } from "@forgecy/ui";
import { env } from "@/lib/env";
import { ActionButton } from "../../_components/action-button";
import { LinkSourceForm, UploadSourceForm } from "../../_components/source-forms";
import { importSourceAction, removeSourceAction } from "../../actions";
import {
  formatDate,
  sourceKindLabel,
  sourceStatusLabel,
  sourceStatusVariant,
} from "../../_lib/labels";
import { loadBrand, sourcesFor } from "../../_lib/server";

export const metadata = { title: "Sources · Brand Identity" };

const size = (n: number | null) =>
  n === null
    ? ""
    : n > 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(1)} MB`
      : `${Math.ceil(n / 1024)} KB`;

export default async function SourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
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

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <Card className="overflow-hidden p-0">
        {sources.length === 0 ? (
          <p className="p-6 text-body-md text-fg-muted">
            No sources yet. Import the client’s brand book or add a link.
          </p>
        ) : (
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">Brand Identity sources</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Source
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Added
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
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
                      {sourceKindLabel[s.kind]}
                      {s.size ? ` · ${size(s.size)}` : ""}
                      {s.pageCount ? ` · ${s.pageCount} parts read` : ""}
                    </span>
                    {s.statusDetail ? (
                      <span className="block text-fg-muted">{s.statusDetail}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={sourceStatusVariant[s.status]}>
                      {sourceStatusLabel[s.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{formatDate(s.capturedAt)}</td>
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
                          Read again
                        </ActionButton>
                      ) : null}
                      <ActionButton
                        variant="ghost"
                        size="sm"
                        confirm="Remove the source? Pending proposals that cite it become superseded. The file and the history are kept."
                        action={removeSourceAction.bind(null, {
                          slug: client.slug,
                          clientId: client.id,
                          sourceId: s.id,
                        })}
                      >
                        Remove
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">Import brand book</h2>
          <p className="mt-1 text-body-sm text-fg-muted">
            {noAi
              ? "AI features are off for this client: we only extract text, colors and fonts, without interpreted proposals."
              : "Text, colors and fonts become proposals with the page they come from. Nothing enters the draft without a person."}
          </p>
          <div className="mt-4">
            <UploadSourceForm slug={client.slug} open={sp.import === "1"} />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">Add a link or note</h2>
          <div className="mt-4">
            <LinkSourceForm slug={client.slug} clientId={client.id} />
          </div>
        </Card>
      </div>
    </div>
  );
}
