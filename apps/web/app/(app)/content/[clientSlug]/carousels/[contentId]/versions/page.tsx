import { findLayout } from "@forgecy/carousel";
import { compareCarouselVersions, parseDocument } from "@forgecy/content";
import { and, contentVersions, eq, inArray } from "@forgecy/db";
import { Badge, Button, Card } from "@forgecy/ui";
import { Columns2 } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { SlideFrame } from "@/app/(app)/templates/slide-frame";
import { getFormat } from "@/lib/i18n";
import { carouselPath } from "../../../../_lib/paths";
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

/** Same look as the shared form controls; kept here because those live in client modules. */
const selectClass =
  "rounded-md border border-control bg-surface px-3 py-2 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const num = (v: string | string[] | undefined) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** `?compare=2..5`, or `?from=2&to=5` from the picker; older version on the left. */
function compareParam(sp: Record<string, string | string[] | undefined>): [number, number] | null {
  const raw = Array.isArray(sp.compare) ? sp.compare[0] : sp.compare;
  const m = raw?.match(/^(\d+)\.\.(\d+)$/);
  const a = m ? Number(m[1]) : num(sp.from);
  const b = m ? Number(m[2]) : num(sp.to);
  if (!a || !b) return null;
  return a <= b ? [a, b] : [b, a];
}

export default async function VersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; contentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug, contentId }, sp] = await Promise.all([params, searchParams]);
  const { db, client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
  const t = await getTranslations("content.versions");
  const tl = await getTranslations("content.labels");
  const format = await getFormat();
  const editable = EDITABLE.includes(c.status) && !ws.locked;
  const act = { slug: client.slug, clientId: client.id, id: c.id };
  const base = carouselPath(client.slug, c.id);
  const pair = compareParam(sp);

  const picker =
    ws.versions.length > 1 ? (
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-body-sm text-fg-muted">
          {t("compare.from")}
          <select
            name="from"
            defaultValue={pair?.[0] ?? ws.versions[1]?.number}
            className={selectClass}
          >
            {ws.versions.map((v) => (
              <option key={v.id} value={v.number}>
                {tl("versionShort", { number: v.number })}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-body-sm text-fg-muted">
          {t("compare.to")}
          <select
            name="to"
            defaultValue={pair?.[1] ?? ws.versions[0]?.number}
            className={selectClass}
          >
            {ws.versions.map((v) => (
              <option key={v.id} value={v.number}>
                {tl("versionShort", { number: v.number })}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" size="sm">
          <Columns2 aria-hidden />
          {t("compare.submit")}
        </Button>
        {pair ? (
          <Link href={`${base}/versions` as Route} className="text-body-sm">
            {t("compare.back")}
          </Link>
        ) : null}
      </form>
    ) : null;

  if (pair) {
    const rows = await db
      .select()
      .from(contentVersions)
      .where(and(eq(contentVersions.contentId, c.id), inArray(contentVersions.number, pair)));
    const left = rows.find((r) => r.number === pair[0]);
    const right = rows.find((r) => r.number === pair[1]);
    const manifest = ws.template?.manifest ?? null;
    const missing = !left ? pair[0] : !right ? pair[1] : null;
    let body;
    if (missing !== null)
      body = (
        <p role="alert" className="text-body-md text-error">
          {t("compare.missing", { number: missing })}
        </p>
      );
    else if (pair[0] === pair[1])
      body = <p className="text-body-md text-fg-muted">{t("compare.same")}</p>;
    else {
      const ld = parseDocument(left!.document);
      const rd = parseDocument(right!.document);
      const cmp = compareCarouselVersions(ld, rd);
      const scale = manifest ? 300 / manifest.width : 1;
      const partLabel = (layout: string, part: string) =>
        part === "layout" || part === "tone"
          ? t(`compare.part.${part}`)
          : ((manifest &&
              findLayout(manifest, layout)?.slots.find((x) => x.name === part)?.label) ??
            part);
      const frame = (versionId: string, index: number | null, number: number) =>
        index === null || !manifest ? (
          <div
            className="grid place-items-center rounded-md border border-dashed border-subtle text-body-sm text-fg-muted"
            style={
              manifest ? { width: manifest.width * scale, height: manifest.height * scale } : {}
            }
          >
            {t("compare.notThere", { number })}
          </div>
        ) : (
          <SlideFrame
            src={`${base}/preview?version=${versionId}&index=${index}`}
            title={t("compare.slideOf", { number: index + 1, version: number })}
            width={manifest.width}
            height={manifest.height}
            scale={scale}
          />
        );
      body = (
        <Card className="p-6">
          <h2 className="text-heading-md text-fg">
            {t("compare.title", { left: pair[0], right: pair[1] })}
          </h2>
          <p className="mt-1 text-body-sm text-fg-muted">
            {t("compare.count", { count: cmp.changedCount })}
          </p>
          <p className="mt-4 text-body-sm text-fg-muted lg:hidden">{t("compare.narrow")}</p>
          <ol className="mt-6 hidden space-y-8 lg:block">
            {cmp.slides.map((s) => {
              const slide = (
                s.rightIndex !== null ? rd.slides[s.rightIndex] : ld.slides[s.leftIndex!]
              )!;
              return (
                <li key={s.slideId} className="grid grid-cols-[12rem_auto_auto] items-start gap-6">
                  <div className="space-y-2">
                    <p className="text-heading-sm text-fg">
                      {t("compare.slide", {
                        left: s.leftIndex === null ? "—" : s.leftIndex + 1,
                        right: s.rightIndex === null ? "—" : s.rightIndex + 1,
                      })}
                    </p>
                    <span className="flex flex-wrap gap-1">
                      <Badge variant={s.change === "same" ? "neutral" : "info"}>
                        {t(`compare.change.${s.change}`)}
                      </Badge>
                      {s.moved ? <Badge>{t("compare.moved")}</Badge> : null}
                    </span>
                    {s.changedParts.length ? (
                      <p className="text-body-sm text-fg-muted">
                        {t("compare.parts", {
                          parts: s.changedParts.map((p) => partLabel(slide.layout, p)).join(", "),
                        })}
                      </p>
                    ) : null}
                  </div>
                  {frame(left!.id, s.leftIndex, pair[0])}
                  {frame(right!.id, s.rightIndex, pair[1])}
                </li>
              );
            })}
          </ol>
          <div className="mt-8 hidden gap-6 lg:grid lg:grid-cols-[12rem_1fr_1fr]">
            <p className="text-heading-sm text-fg">
              {t("compare.caption")}
              {cmp.captionChanged || cmp.hashtagsChanged ? (
                <span className="mt-2 block">
                  <Badge variant="info">{t("compare.change.changed")}</Badge>
                </span>
              ) : null}
            </p>
            {[ld, rd].map((d, i) => (
              <div key={i} className="space-y-2 text-body-sm">
                <p className="whitespace-pre-line text-fg">{d.caption || "—"}</p>
                <p className="text-fg-muted">{d.hashtags.join(" ")}</p>
              </div>
            ))}
          </div>
        </Card>
      );
    }
    return (
      <div className="grid gap-6">
        {picker}
        {body}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {picker}
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
    </div>
  );
}
