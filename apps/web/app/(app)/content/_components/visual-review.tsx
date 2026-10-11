"use client";

import { MAX_VISUAL_ROUNDS, orderVisualNotes } from "@forgecy/content/client";
import { Badge, Button, cn } from "@forgecy/ui";
import { Eye, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import { reviewSlidesAction } from "../visual-actions";
import { RefreshWhile } from "./refresh-while";

/** One reviewed slide: its PNG and the template's safe box, as percent of the slide. */
export interface VisualSheetSlide {
  slide: number;
  url: string;
  safe: { top: number; right: number; bottom: number; left: number };
  /** CSS aspect-ratio of the slide, e.g. "1080 / 1350". */
  ratio: string;
}

export interface VisualReviewNote {
  slide: number;
  problem: string;
  fix: string;
}

/** Dismissals are a per-person convenience kept in this browser, per review. */
const storeKey = (jobId: string) => `forgecy:visual-dismissed:${jobId}`;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

function readRaw(jobId: string | null): string {
  if (!jobId) return "[]";
  try {
    return window.localStorage.getItem(storeKey(jobId)) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseDismissed(raw: string): number[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}

/** “Review the slides”: advisory AI pass; notes sit next to the claim check, each can be dismissed. */
export function VisualReview({
  slug,
  clientId,
  contentId,
  running,
  disabled,
  review,
  stale,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  /** A review is queued or running: the page refreshes until it ends. */
  running: boolean;
  disabled: boolean;
  /** The latest finished review, or null when there has been none. */
  review: {
    jobId: string;
    mode: "images" | "text";
    round: number;
    notes: VisualReviewNote[];
    sheet: VisualSheetSlide[];
  } | null;
  /** The draft changed after the review ran. */
  stale: boolean;
}) {
  const t = useTranslations("content.editor.visual");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const jobId = review?.jobId ?? null;
  // The server render shows every note; the browser then hides the ones this person dismissed.
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(jobId),
    () => "[]",
  );
  const dismissed = parseDismissed(raw);
  const busy = pending || running;
  const shown = orderVisualNotes((review?.notes ?? []).map((n, index) => ({ ...n, index }))).filter(
    (x) => !dismissed.includes(x.index),
  );
  const capped = review !== null && review.round >= MAX_VISUAL_ROUNDS && shown.length > 0;
  const run = (restart: boolean) => {
    setError(null);
    start(async () => {
      const r = await reviewSlidesAction({
        slug,
        clientId,
        contentId,
        ...(restart ? { restart } : {}),
      });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };
  const show = (slide: number) => {
    setFocus(slide);
    document
      .getElementById(`vr-${jobId}-${slide}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const dismiss = (index: number) => {
    if (!jobId) return;
    try {
      window.localStorage.setItem(storeKey(jobId), JSON.stringify([...dismissed, index]));
    } catch {
      // storage blocked: the note stays until the page is reloaded
    }
    listeners.forEach((fn) => fn());
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-subtle bg-surface p-3">
      <RefreshWhile active={running} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || busy}
          title={t("hint")}
          onClick={() => run(capped)}
        >
          {review && !busy ? <RefreshCw aria-hidden /> : <Eye aria-hidden />}
          {busy
            ? t("checking")
            : capped
              ? t("restart")
              : review && shown.length
                ? t("again")
                : t("button")}
        </Button>
        <p className="text-body-sm text-fg-muted" role="status">
          {review && !busy
            ? `${t("last", { count: shown.length })} ${t("mode", { mode: review.mode })}`
            : t("hint")}
        </p>
        {error ? (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
      {review && !busy && stale ? <p className="text-body-sm text-fg-muted">{t("stale")}</p> : null}
      {review && !busy && shown.length ? (
        <p className="text-body-sm text-fg-muted" role="status">
          {capped
            ? t("stopHere", { max: MAX_VISUAL_ROUNDS })
            : t("round", { round: review.round, max: MAX_VISUAL_ROUNDS })}
        </p>
      ) : null}
      {review && !busy && review.sheet.length ? (
        <ol className="grid grid-cols-4 gap-2" aria-label={t("sheet")}>
          {review.sheet.map((s) => (
            <li
              key={s.slide}
              id={`vr-${review.jobId}-${s.slide}`}
              className={cn(
                "flex flex-col gap-1 rounded-md border p-1",
                focus === s.slide ? "border-primary" : "border-subtle",
              )}
            >
              <div className="relative w-full" style={{ aspectRatio: s.ratio }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
                <img
                  src={s.url}
                  alt={t("slide", { slide: s.slide })}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full rounded-sm object-contain"
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute border border-dashed border-warning"
                  style={{
                    top: `${s.safe.top}%`,
                    right: `${s.safe.right}%`,
                    bottom: `${s.safe.bottom}%`,
                    left: `${s.safe.left}%`,
                  }}
                />
              </div>
              <span className="text-label text-fg-muted">{t("slide", { slide: s.slide })}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {review && !busy && shown.length ? (
        <ul className="flex flex-col gap-2">
          {shown.map((n, position) => (
            <li
              key={n.index}
              className={cn(
                "flex items-start justify-between gap-3 rounded-md border p-2",
                position === 0 ? "border-primary" : "border-subtle",
              )}
            >
              <div className="flex flex-col gap-1">
                {position === 0 ? <Badge variant="info">{t("next")}</Badge> : null}
                <button
                  type="button"
                  className="text-left text-body-sm font-medium text-fg hover:underline"
                  onClick={() => show(n.slide)}
                >
                  {t("slide", { slide: n.slide })}: {n.problem}
                </button>
                {n.fix ? (
                  <p className="text-body-sm text-fg-muted">{t("fix", { fix: n.fix })}</p>
                ) : null}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => dismiss(n.index)}>
                <X aria-hidden />
                {t("dismiss")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
