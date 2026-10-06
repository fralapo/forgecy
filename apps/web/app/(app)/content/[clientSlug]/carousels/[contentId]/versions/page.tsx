import { Badge, Card } from "@forgecy/ui";
import { ActionButton } from "../../../../_components/action-button";
import { CarouselVersionForm } from "../../../../_components/carousel-version-form";
import { restoreVersionAction } from "../../../../actions";
import { formatDate } from "../../../../_lib/paths";
import { versionOriginLabels } from "../../_lib/labels";
import { loadCarousel } from "../../_lib/workspace";

export const metadata = { title: "Versioni · Carosello" };

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
          <p className="p-6 text-body-md text-fg-muted">Ancora nessuna versione salvata.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">Versioni del carosello</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Versione
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Origine
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Autore e data
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Nota
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
                      <span className="text-heading-sm text-fg">v{v.number}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {v.id === c.approvedVersionId ? (
                          <Badge variant="success">Approvata</Badge>
                        ) : null}
                        {v.id === c.currentVersionId ? <Badge>Corrente</Badge> : null}
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
                        confirm={`Ripristinare la versione ${v.number}? La bozza attuale viene sostituita da questa versione e il carosello torna in bozza.`}
                        action={restoreVersionAction.bind(null, { ...act, number: v.number })}
                      >
                        Ripristina
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
        <h3 className="text-heading-sm text-fg">Salva la bozza come versione</h3>
        <p className="text-body-sm text-fg-muted">
          Ultima modifica della bozza: {formatDate(c.draftUpdatedAt)}
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
