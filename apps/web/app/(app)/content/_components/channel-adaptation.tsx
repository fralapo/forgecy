"use client";

import { Button } from "@forgecy/ui";
import { Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  acceptAdaptationAction,
  askAdaptationAction,
  dismissAdaptationAction,
} from "../adapt-actions";
import { carouselPath } from "../_lib/paths";
import { RefreshWhile } from "./refresh-while";

export interface AdaptationItem {
  jobId: string;
  channel: "linkedin" | "facebook";
  creditableAngle: boolean;
  angle: string;
  reason: string;
  slides: { layout: string; texts: string[] }[];
  caption: string;
  hashtags: string[];
  gateMetric: string;
  /** The source carousel changed after the proposal was made. */
  stale: boolean;
  decision: { status: "accepted" | "dismissed"; contentId: string | null } | null;
}

const channels = ["linkedin", "facebook"] as const;

/**
 * “Other channels”: the AI proposes an Instagram carousel for LinkedIn or Facebook (or says to
 * skip the channel). Accepting creates a new draft; dismissing answers it. Never automatic.
 */
export function ChannelAdaptation({
  slug,
  clientId,
  contentId,
  running,
  canAsk,
  items,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  /** An adaptation is queued or running: the page refreshes until it ends. */
  running: boolean;
  /** The source is an Instagram carousel in review or approved. */
  canAsk: boolean;
  items: AdaptationItem[];
}) {
  const t = useTranslations("content.editor.adapt");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = pending || running;
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-subtle bg-surface p-3">
      <RefreshWhile active={running} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-body-sm font-medium text-fg">{t("heading")}</h2>
        {channels.map((channel) => (
          <Button
            key={channel}
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canAsk || busy}
            title={t("hint")}
            onClick={() => run(() => askAdaptationAction({ slug, clientId, contentId, channel }))}
          >
            <Share2 aria-hidden />
            {busy ? t("asking") : t("ask", { channel })}
          </Button>
        ))}
        <p className="text-body-sm text-fg-muted" role="status">
          {canAsk ? t("hint") : t("needsReview")}
        </p>
        {error ? (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
      {items.map((it) => (
        <section
          key={it.jobId}
          className="flex flex-col gap-2 rounded-md border border-subtle p-3"
          aria-label={t("channel", { channel: it.channel })}
        >
          <h3 className="text-body-sm font-medium text-fg">
            {t("channel", { channel: it.channel })}
          </h3>
          {it.stale ? <p className="text-body-sm text-fg-muted">{t("stale")}</p> : null}
          {it.creditableAngle ? (
            <>
              <p className="text-body-sm text-fg">
                <span className="font-medium">{t("angle")}: </span>
                {it.angle}
              </p>
              {it.reason ? (
                <p className="text-body-sm text-fg-muted">{t("reason", { reason: it.reason })}</p>
              ) : null}
              <p className="text-body-sm text-fg-muted">
                {t("slides", { count: it.slides.length })}
              </p>
              <ol className="flex flex-col gap-1">
                {it.slides.map((s, i) => (
                  <li key={i} className="text-body-sm text-fg">
                    <span className="text-fg-muted">
                      {t("slide", { slide: i + 1, layout: s.layout })}:{" "}
                    </span>
                    {s.texts.join(" · ")}
                  </li>
                ))}
              </ol>
              <p className="text-body-sm text-fg">
                <span className="font-medium">{t("caption")}: </span>
                <span className="whitespace-pre-line">{it.caption}</span>
              </p>
              {it.hashtags.length ? (
                <p className="text-body-sm text-fg">
                  <span className="font-medium">{t("hashtags")}: </span>
                  {it.hashtags.join(" ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-body-sm text-fg">
              {it.reason ? `${t("skip")} ${t("reason", { reason: it.reason })}` : t("skipNoReason")}
            </p>
          )}
          <p className="text-body-sm text-fg-muted">
            <span className="font-medium">{t("gate")}: </span>
            {t("gateMetric", { metric: it.gateMetric })}
          </p>
          {it.decision ? (
            <p className="text-body-sm text-fg-muted">
              {it.decision.status === "accepted" ? t("accepted") : t("dismissed")}{" "}
              {it.decision.contentId ? (
                <Link className="underline" href={carouselPath(slug, it.decision.contentId)}>
                  {t("openDraft")}
                </Link>
              ) : null}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {it.creditableAngle ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    start(async () => {
                      const r = await acceptAdaptationAction({
                        slug,
                        clientId,
                        jobId: it.jobId,
                      });
                      if (!r.ok) setError(r.error);
                      else router.push(carouselPath(slug, r.contentId));
                    });
                  }}
                >
                  {t("accept")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(() => dismissAdaptationAction({ slug, clientId, jobId: it.jobId }))
                }
              >
                {t("dismiss")}
              </Button>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
