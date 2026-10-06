import { briefReady } from "@forgecy/content";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
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
import { carouselPath, formatDate } from "../../../../_lib/paths";
import { outlineOriginLabels } from "../../_lib/labels";
import { loadCarousel } from "../../_lib/workspace";

export const metadata = { title: "Scaletta · Carosello" };

const EDITABLE = ["draft", "changes_requested", "approved", "exported"];

export default async function OutlinePage({
  params,
}: {
  params: Promise<{ clientSlug: string; contentId: string }>;
}) {
  const { clientSlug, contentId } = await params;
  const { client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
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
            Il brief è cambiato dopo questa scaletta: rigenerala o rivedila prima di approvarla.
          </p>
        ) : null}
        <Card className="grid gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-heading-sm text-fg">
              Scaletta{ws.outline ? ` n. ${c.outlineNumber}` : ""}
            </h3>
            {ws.outline ? (
              approved ? (
                <Badge variant="success">Approvata il {formatDate(c.outlineApprovedAt)}</Badge>
              ) : (
                <Badge variant="warning">Da approvare</Badge>
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
                  Approva scaletta
                </ActionButton>
              ) : null}
              <ActionButton
                variant={approved ? "primary" : "secondary"}
                disabled={!editable || !approved}
                title={approved ? undefined : "Approva prima la scaletta"}
                confirm={
                  hasSlides
                    ? "Le slide attuali vengono riscritte dalla scaletta approvata. Continuare?"
                    : undefined
                }
                action={generateSlidesAction.bind(null, act)}
              >
                {hasSlides ? "Rigenera slide" : "Genera slide"}
              </ActionButton>
              {hasSlides ? (
                <Link href={`${base}/editor` as Route} className="self-center text-body-sm">
                  Apri l&apos;editor
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
          <h3 className="text-heading-sm text-fg">Copywriter</h3>
          {!ready ? (
            <p className="text-body-sm text-fg-muted">
              Scrivi un brief di almeno 20 caratteri per generare la scaletta.{" "}
              <Link href={base as Route}>Apri il brief</Link>
            </p>
          ) : null}
          <CarouselOutlineGenerate
            refs={refs}
            hasOutline={Boolean(ws.outline)}
            disabled={!editable || !ready}
          />
        </Card>
        <Card className="grid gap-3 p-5">
          <h3 className="text-heading-sm text-fg">Scalette precedenti</h3>
          {ws.outlines.length <= 1 ? (
            <p className="text-body-sm text-fg-muted">Nessuna scaletta precedente.</p>
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
                        n. {o.number} · {outlineOriginLabels[o.origin]}
                      </span>
                      <span className="block text-fg-muted">{formatDate(o.createdAt)}</span>
                      {o.instruction ? (
                        <span className="block text-fg-muted">«{o.instruction}»</span>
                      ) : null}
                    </span>
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      disabled={!editable}
                      confirm={`Ripristinare la scaletta n. ${o.number}? Diventa una nuova scaletta da approvare.`}
                      action={restoreOutlineAction.bind(null, { ...act, number: o.number })}
                    >
                      Ripristina
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
