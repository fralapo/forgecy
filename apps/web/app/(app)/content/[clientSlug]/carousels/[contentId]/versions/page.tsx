import { Badge, Card } from "@forgecy/ui";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/lib/i18n";
import { ActionButton } from "../../../../_components/action-button";
import { CarouselVersionForm } from "../../../../_components/carousel-version-form";
import { restoreVersionAction } from "../../../../actions";
import { loadCarousel } from "../../_lib/workspace";

export async function generateMetadata() {
  const t = await getTranslations("content.versions");
  return { title: t("metaTitle") };
}

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
  const t = await getTranslations("content.versions");
  const tl = await getTranslations("content.labels");
  const format = await getFormat();
  const editable = EDITABLE.includes(c.status) && !ws.locked;
  const act = { slug: client.slug, clientId: client.id, id: c.id };

  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <Card className="overflow-hidden p-0">
        {ws.versions.length === 0 ? (
          <p className="p-6 text-body-md text-fg-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">{t("table.caption")}</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("table.version")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("table.origin")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("table.author")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("table.note")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">{t("table.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ws.versions.map((v) => (
                  <tr key={v.id} className="border-b border-subtle align-top last:border-0">
                    <td className="px-4 py-3">
                      <span className="text-heading-sm text-fg">
                        {tl("versionShort", { number: v.number })}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {v.id === c.approvedVersionId ? (
                          <Badge variant="success">{t("approved")}</Badge>
                        ) : null}
                        {v.id === c.currentVersionId ? <Badge>{t("current")}</Badge> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-fg">{tl(`versionOrigin.${v.createdFrom}`)}</td>
                    <td className="px-4 py-3 text-fg">
                      {v.authorName ?? t("ai")}
                      <span className="block text-fg-muted">
                        {format.date(v.createdAt, "dateTime")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-fg">{noteOf(v.meta) || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <ActionButton
                        size="sm"
                        variant="secondary"
                        disabled={!editable}
                        confirm={t("restoreConfirm", { number: v.number })}
                        action={restoreVersionAction.bind(null, { ...act, number: v.number })}
                      >
                        {t("restore")}
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
        <h3 className="text-heading-sm text-fg">{t("saveTitle")}</h3>
        <p className="text-body-sm text-fg-muted">
          {t("lastEdited", {
            date: c.draftUpdatedAt ? format.date(c.draftUpdatedAt, "dateTime") : "—",
          })}
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
