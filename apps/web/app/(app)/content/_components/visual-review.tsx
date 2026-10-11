"use client";

import { Button } from "@forgecy/ui";
import { Eye, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import { reviewSlidesAction } from "../visual-actions";
import { RefreshWhile } from "./refresh-while";

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
  review: { jobId: string; mode: "images" | "text"; notes: VisualReviewNote[] } | null;
  /** The draft changed after the review ran. */
  stale: boolean;
}) {
  const t = useTranslations("content.editor.visual");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const jobId = review?.jobId ?? null;
  // The server render shows every note; the browser then hides the ones this person dismissed.
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(jobId),
    () => "[]",
  );
  const dismissed = parseDismissed(raw);
  const busy = pending || running;
  const shown = (review?.notes ?? [])
    .map((n, index) => ({ n, index }))
    .filter((x) => !dismissed.includes(x.index));
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
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await reviewSlidesAction({ slug, clientId, contentId });
              if (!r.ok) setError(r.error);
              else router.refresh();
            });
          }}
        >
          <Eye aria-hidden />
          {busy ? t("checking") : t("button")}
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
        <ul className="flex flex-col gap-2">
          {shown.map(({ n, index }) => (
            <li
              key={index}
              className="flex items-start justify-between gap-3 rounded-md border border-subtle p-2"
            >
              <div className="flex flex-col gap-1">
                <p className="text-body-sm font-medium text-fg">
                  {t("slide", { slide: n.slide })}: {n.problem}
                </p>
                {n.fix ? (
                  <p className="text-body-sm text-fg-muted">{t("fix", { fix: n.fix })}</p>
                ) : null}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => dismiss(index)}>
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
