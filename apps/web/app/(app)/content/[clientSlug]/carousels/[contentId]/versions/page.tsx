import { Badge, Card } from "@forgecy/ui";
import { ActionButton } from "../../../../_components/action-button";
import { CarouselVersionForm } from "../../../../_components/carousel-version-form";
import { restoreVersionAction } from "../../../../actions";
import { formatDate } from "../../../../_lib/paths";
import { versionOriginLabels } from "../../_lib/labels";
import { loadCarousel } from "../../_lib/workspace";

export const metadata = { title: "Versions · Carousel" };

const EDITABLE = ["draft", "changes_requested", "approved", "exported"];

const noteOf = (meta: unknown) =>
  meta && typeof meta === "object" && "note" in meta && typeof meta.note === "string"
    ? meta.note
    : "";

export default async function VersionsPage({
  params,
}: {
  params: Promise<{ clientSlug: string; contentId: string }>;
}) {
  const { clientSlug, contentId } = await params;
  const { client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
  const editable = EDITABLE.includes(c.status) && !ws.locked;
  const act = { slug: client.slug, clientId: client.id, id: c.id };

  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <Card className="overflow-hidden p-0">
        {ws.versions.length === 0 ? (
          <p className="p-6 text-body-md text-fg-muted">No saved versions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">Carousel versions</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Version
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Origin
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Author and date
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Note
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
                      <span className="text-heading-sm text-fg">v{v.number}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {v.id === c.approvedVersionId ? (
                          <Badge variant="success">Approved</Badge>
                        ) : null}
                        {v.id === c.currentVersionId ? <Badge>Current</Badge> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-fg">{versionOriginLabels[v.createdFrom]}</td>
                    <td className="px-4 py-3 text-fg">
                      {v.authorName ?? "AI"}
                      <span className="block text-fg-muted">{formatDate(v.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3 text-fg">{noteOf(v.meta) || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <ActionButton
                        size="sm"
                        variant="secondary"
                        disabled={!editable}
                        confirm={`Restore version ${v.number}? The current draft is replaced by this version and the carousel goes back to draft.`}
                        action={restoreVersionAction.bind(null, { ...act, number: v.number })}
                      >
                        Restore
                      </ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="grid content-start gap-3 p-5">
        <h3 className="text-heading-sm text-fg">Save the draft as a version</h3>
        <p className="text-body-sm text-fg-muted">
          Draft last edited: {formatDate(c.draftUpdatedAt)}
        </p>
        <CarouselVersionForm
          slug={client.slug}
          clientId={client.id}
          contentId={c.id}
          draftRev={c.draftRev}
          disabled={!editable || ws.document.slides.length === 0}
        />
      </Card>
    </div>
  );
}
