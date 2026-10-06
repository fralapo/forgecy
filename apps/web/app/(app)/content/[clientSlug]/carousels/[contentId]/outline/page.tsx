import { briefReady } from "@forgecy/content";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/lib/i18n";
import { ActionButton } from "../../../../_components/action-button";
import {
  CarouselOutlineEditor,
  CarouselOutlineGenerate,
} from "../../../../_components/carousel-outline";
import {
  approveOutlineAction,
  generateSlidesAction,
  restoreOutlineAction,
} from "../../../../actions";
import { carouselPath } from "../../../../_lib/paths";
import { loadCarousel } from "../../_lib/workspace";

export async function generateMetadata() {
  const t = await getTranslations("content.outline");
  return { title: t("metaTitle") };
}

const EDITABLE = ["draft", "changes_requested", "approved", "exported"];

export default async function OutlinePage({
  params,
}: {
  params: Promise<{ clientSlug: string; contentId: string }>;
}) {
  const { clientSlug, contentId } = await params;
  const { client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
  const t = await getTranslations("content.outline");
  const tl = await getTranslations("content.labels");
  const format = await getFormat();
  const editable = EDITABLE.includes(c.status) && !ws.locked;
  const ready = briefReady(c.brief);
  const refs = { slug: client.slug, clientId: client.id, contentId: c.id };
  const act = { slug: client.slug, clientId: client.id, id: c.id };
  const base = carouselPath(client.slug, c.id);
  const approved = Boolean(ws.outline && c.outlineApprovedAt);
  const hasSlides = ws.document.slides.length > 0;
  const layouts = (ws.template?.manifest.layouts ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    role: l.role,
  }));

  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <div className="grid content-start gap-6">
        {ws.outlineStale ? (
          <p
            role="status"
            className="rounded-md border border-warning-fill bg-surface px-4 py-3 text-body-sm text-fg"
          >
            {t("stale")}
          </p>
        ) : null}
        <Card className="grid gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-heading-sm text-fg">
              {ws.outline ? t("titleNumber", { number: c.outlineNumber }) : t("title")}
            </h3>
            {ws.outline ? (
              approved ? (
                <Badge variant="success">
                  {t("approvedOn", {
                    date: c.outlineApprovedAt ? format.date(c.outlineApprovedAt, "dateTime") : "—",
                  })}
                </Badge>
              ) : (
                <Badge variant="warning">{t("toApprove")}</Badge>
              )
            ) : null}
          </div>
          {ws.outline ? (
            <div className="flex flex-wrap items-start gap-3">
              {!approved ? (
                <ActionButton
                  disabled={!editable}
                  action={approveOutlineAction.bind(null, {
                    ...act,
                    outlineNumber: c.outlineNumber,
                  })}
                >
                  {t("approve")}
                </ActionButton>
              ) : null}
              <ActionButton
                variant={approved ? "primary" : "secondary"}
                disabled={!editable || !approved}
                title={approved ? undefined : t("approveFirst")}
                confirm={hasSlides ? t("regenerateConfirm") : undefined}
                action={generateSlidesAction.bind(null, act)}
              >
                {hasSlides ? t("regenerate") : t("generate")}
              </ActionButton>
              {hasSlides ? (
                <Link href={`${base}/editor` as Route} className="self-center text-body-sm">
                  {t("openEditor")}
                </Link>
              ) : null}
            </div>
          ) : null}
          <CarouselOutlineEditor
            key={c.outlineNumber}
            refs={refs}
            outline={ws.outline}
            outlineNumber={c.outlineNumber}
            layouts={layouts}
            slideCount={c.slideCount}
            editable={editable}
          />
        </Card>
      </div>
      <div className="grid content-start gap-6">
        <Card className="grid gap-3 p-5">
          <h3 className="text-heading-sm text-fg">{tl("agent.copywriter")}</h3>
          {!ready ? (
            <p className="text-body-sm text-fg-muted">
              {t("briefRequired")} <Link href={base as Route}>{t("openBrief")}</Link>
            </p>
          ) : null}
          <CarouselOutlineGenerate
            refs={refs}
            hasOutline={Boolean(ws.outline)}
            disabled={!editable || !ready}
          />
        </Card>
        <Card className="grid gap-3 p-5">
          <h3 className="text-heading-sm text-fg">{t("previous")}</h3>
          {ws.outlines.length <= 1 ? (
            <p className="text-body-sm text-fg-muted">{t("noPrevious")}</p>
          ) : (
            <ul className="grid gap-3">
              {ws.outlines
                .filter((o) => o.number !== c.outlineNumber)
                .map((o) => (
                  <li
                    key={o.number}
                    className="flex flex-wrap items-start justify-between gap-2 text-body-sm"
                  >
                    <span>
                      <span className="text-fg">
                        {t("previousItem", {
                          number: o.number,
                          origin: tl(`outlineOrigin.${o.origin}`),
                        })}
                      </span>
                      <span className="block text-fg-muted">
                        {format.date(o.createdAt, "dateTime")}
                      </span>
                      {o.instruction ? (
                        <span className="block text-fg-muted">“{o.instruction}”</span>
                      ) : null}
                    </span>
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      disabled={!editable}
                      confirm={t("restoreConfirm", { number: o.number })}
                      action={restoreOutlineAction.bind(null, { ...act, number: o.number })}
                    >
                      {t("restore")}
                    </ActionButton>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
