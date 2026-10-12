"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { ExternalLink, Images, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  addStockCreditAction,
  importPexelsPhotoAction,
  searchPexelsAction,
} from "../[clientSlug]/library/actions";
import { controlClass } from "./action-button";

interface Photo {
  id: number;
  url: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  srcMedium: string;
}

const orientations = ["portrait", "landscape", "square"] as const;

/**
 * Pexels search: pick a photo, the server downloads it into the library (rights stay
 * pending) and, inside the editor (`contentId`), the photographer credit goes to the
 * content's credit lines and `onPicked` assigns it to the slot. Pexels asks for a visible
 * link to Pexels and to the photographer, so both stay on every result.
 */
export function StockSearch({
  slug,
  clientId,
  contentId,
  enabled,
  defaultOrientation = "portrait",
  onPicked,
}: {
  slug: string;
  clientId: string;
  contentId?: string;
  enabled: boolean;
  /** Orientation the slot wants (from its size); the select overrides it. */
  defaultOrientation?: (typeof orientations)[number];
  onPicked?: (asset: { id: string; key: string; alt: string }) => void;
}) {
  const t = useTranslations("content.library.pexels");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [orientation, setOrientation] = useState<(typeof orientations)[number]>(defaultOrientation);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const uid = contentId ?? "library";

  const search = (nextPage: number) =>
    start(async () => {
      setMessage(null);
      const r = await searchPexelsAction({ slug, clientId, query, orientation, page: nextPage });
      if (!r.ok) return setMessage({ kind: "error", text: r.error });
      if (!r.configured) return;
      setPhotos((prev) => (nextPage > 1 && prev ? [...prev, ...r.photos] : r.photos));
      setPage(r.page);
      setTotal(r.total);
      setRemaining(r.remaining);
    });

  const pick = (p: Photo) =>
    start(async () => {
      setMessage(null);
      setBusyId(p.id);
      const r = await importPexelsPhotoAction({
        slug,
        clientId,
        photoId: p.id,
        ...(contentId ? { contentId } : {}),
      });
      setBusyId(null);
      if (!r.ok) return setMessage({ kind: "error", text: r.error });
      if (contentId) {
        const c = await addStockCreditAction({ slug, clientId, contentId, assetId: r.id });
        if (!c.ok) return setMessage({ kind: "error", text: c.error });
      }
      setMessage({ kind: "ok", text: t("imported") });
      onPicked?.({ id: r.id, key: r.key, alt: r.alt });
      router.refresh();
    });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-heading-sm text-fg">{t("title")}</h3>
          {!contentId ? <p className="text-body-sm text-fg-muted">{t("description")}</p> : null}
        </div>
        {enabled ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen((o) => !o)}>
            <Images aria-hidden />
            {open ? t("close") : t("open")}
          </Button>
        ) : null}
      </div>

      {!enabled ? (
        <div className="rounded-md border border-dashed border-subtle p-3 text-body-sm">
          <p className="text-fg">{t("notConfigured")}</p>
          <p className="text-fg-muted">{t("notConfiguredHint")}</p>
        </div>
      ) : null}

      {enabled && open ? (
        <div className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) search(1);
            }}
          >
            <div className="min-w-48 flex-1 space-y-1">
              <Label htmlFor={`pexels-q-${uid}`}>{t("query")}</Label>
              <Input
                id={`pexels-q-${uid}`}
                value={query}
                maxLength={200}
                placeholder={t("queryPlaceholder")}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pexels-o-${uid}`}>{t("orientation")}</Label>
              <select
                id={`pexels-o-${uid}`}
                className={controlClass}
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as (typeof orientations)[number])}
              >
                {orientations.map((o) => (
                  <option key={o} value={o}>
                    {t(`orientations.${o}`)}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={pending || !query.trim()}>
              <Search aria-hidden />
              {pending && busyId === null ? t("searching") : t("submit")}
            </Button>
          </form>

          {message ? (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              className={
                message.kind === "error" ? "text-body-sm text-error" : "text-body-sm text-success"
              }
            >
              {message.text}
            </p>
          ) : null}

          {photos?.length === 0 ? <p className="text-body-sm text-fg-muted">{t("none")}</p> : null}
          {photos?.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
              {photos.map((p) => (
                <li key={p.id} className="min-w-0 space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Pexels CDN preview, no key involved */}
                  <img
                    src={p.srcMedium}
                    alt={p.alt}
                    loading="lazy"
                    className="aspect-square w-full rounded-md border border-subtle bg-app object-cover"
                  />
                  <p className="truncate text-label text-fg-muted">
                    <a
                      href={p.photographerUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-link"
                    >
                      {t("credit", { name: p.photographer })}
                    </a>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" disabled={pending} onClick={() => pick(p)}>
                      {busyId === p.id
                        ? t("importing")
                        : contentId
                          ? t("useInSlot")
                          : t("addToLibrary")}
                    </Button>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-label text-link"
                    >
                      <ExternalLink aria-hidden className="size-3" />
                      {t("viewOnPexels")}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {photos && photos.length < total ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => search(page + 1)}
            >
              {t("more")}
            </Button>
          ) : null}

          <p className="text-label text-fg-muted">
            <a
              href="https://www.pexels.com"
              target="_blank"
              rel="noreferrer noopener"
              className="text-link"
            >
              {t("poweredBy")}
            </a>
            {remaining !== null ? ` · ${t("remaining", { remaining })}` : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
