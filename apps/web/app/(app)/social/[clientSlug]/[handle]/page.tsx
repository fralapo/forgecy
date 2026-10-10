import { and, eq, socialProfiles } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { hasActiveSnapshotJob, loadProfileDetail } from "@forgecy/social";
import { ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { notFound } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getFormat, getRefText } from "@/lib/i18n";
import { ActionButton } from "../../../brand/_components/action-button";
import { RefreshWhile } from "../../../content/_components/refresh-while";
import { readNowAction, tryAgainAction } from "../../actions";
import {
  CadenceCard,
  CaptionsCard,
  EngagementCard,
  EventsCard,
  HashtagsCard,
  MixCard,
  RelationsCard,
} from "../../_components/detail-cards";
import { profileUrl } from "../../_lib/events";
import { SOCIAL_TIME_ZONE, loadSocialClient, socialPath } from "../../_lib/server";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return { title: `@${decodeURIComponent(handle)}` };
}

export default async function SocialProfilePage({
  params,
}: {
  params: Promise<{ clientSlug: string; handle: string }>;
}) {
  const { clientSlug, handle: rawHandle } = await params;
  const handle = decodeURIComponent(rawHandle).replace(/^@/, "").toLowerCase();
  const t = await getTranslations("social");
  const format = await getFormat();
  const refText = await getRefText();
  const { db, user, client, canEdit } = await loadSocialClient(clientSlug);

  const [found] = await db
    .select({ id: socialProfiles.id })
    .from(socialProfiles)
    .where(and(eq(socialProfiles.clientId, client.id), eq(socialProfiles.handle, handle)));
  if (!found) notFound();

  const detail = await loadProfileDetail(db, user.actor, found.id, {
    timeZone: SOCIAL_TIME_ZONE,
  });
  const { profile, snapshot, analysis } = detail;
  const reading = await hasActiveSnapshotJob(db, profile.id);
  const failed = ["error", "blocked", "paused"].includes(profile.status);
  const num = (v: number | null | undefined) =>
    v === null || v === undefined ? t("unavailable") : format.number(v);
  // The link in the bio comes from Instagram: only a web address is made clickable.
  const link =
    snapshot?.externalUrl && /^https?:\/\//i.test(snapshot.externalUrl)
      ? snapshot.externalUrl
      : null;

  return (
    <>
      <p className="mb-2 text-body-sm text-fg-muted">
        <Link href={"/social" as Route}>{t("title")}</Link> ›{" "}
        <Link href={socialPath(client.slug) as Route}>{client.name}</Link> › @{profile.handle}
      </p>
      <RefreshWhile active={reading} />
      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-60 flex-1 space-y-2">
            <h1 className="font-display text-heading-lg text-fg">
              {snapshot?.fullName ?? `@${profile.handle}`}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={profileUrl(profile.handle)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-body-md text-link"
              >
                @{profile.handle}
                <ExternalLink aria-hidden className="size-4" />
                <span className="sr-only">{t("profile.openOnInstagram")}</span>
              </a>
              <Badge variant={profile.role === "self" ? "info" : "neutral"}>
                {t(`roles.${profile.role}`)}
              </Badge>
              <Badge variant={reading ? "info" : failed ? "warning" : "success"}>
                {reading ? t("profile.reading") : t(`state.${profile.status}`)}
              </Badge>
              {snapshot?.isVerified ? (
                <Badge variant="success">{t("profile.verified")}</Badge>
              ) : null}
              {snapshot?.isPrivate ? <Badge variant="warning">{t("profile.private")}</Badge> : null}
              {snapshot?.category ? <Badge>{snapshot.category}</Badge> : null}
            </div>
            {snapshot?.biography ? (
              <p className="max-w-2xl whitespace-pre-line text-body-md text-fg">
                {snapshot.biography}
              </p>
            ) : null}
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 break-all text-body-sm text-link"
              >
                {link}
                <ExternalLink aria-hidden className="size-4 shrink-0" />
                <span className="sr-only">{t("profile.link")}</span>
              </a>
            ) : null}
            {failed && !reading && profile.statusReason ? (
              <p className="text-body-sm text-fg">
                {refText(profile.statusReason, profile.statusReason.key)}
              </p>
            ) : null}
          </div>
          {canEdit ? (
            failed && !reading ? (
              <ActionButton
                action={tryAgainAction.bind(null, client.slug, profile.id)}
                variant="secondary"
              >
                <RotateCcw aria-hidden />
                {t("list.tryAgain")}
              </ActionButton>
            ) : (
              <ActionButton
                action={readNowAction.bind(null, client.slug, profile.id)}
                variant="secondary"
                disabled={reading}
              >
                <RefreshCw aria-hidden />
                {t("profile.readNow")}
              </ActionButton>
            )
          ) : null}
        </div>
        <dl className="grid grid-cols-3 gap-4 border-t border-subtle pt-4">
          <div>
            <dt className="text-body-sm text-fg-muted">{t("profile.followers")}</dt>
            <dd className="text-heading-sm text-fg">{num(snapshot?.followers)}</dd>
          </div>
          <div>
            <dt className="text-body-sm text-fg-muted">{t("profile.following")}</dt>
            <dd className="text-heading-sm text-fg">{num(snapshot?.following)}</dd>
          </div>
          <div>
            <dt className="text-body-sm text-fg-muted">{t("profile.posts")}</dt>
            <dd className="text-heading-sm text-fg">{num(snapshot?.postsTotal)}</dd>
          </div>
        </dl>
        <p className="text-body-sm text-fg-muted">
          {snapshot
            ? t("profile.readFrom", {
                source: t(`sources.${snapshot.source}`),
                date: format.date(snapshot.observedAt),
              })
            : t("profile.neverRead")}
        </p>
      </Card>
      {analysis ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <MixCard analysis={analysis} />
          <EngagementCard analysis={analysis} />
          <CadenceCard analysis={analysis} />
          <HashtagsCard analysis={analysis} />
          <CaptionsCard analysis={analysis} />
          <RelationsCard edges={detail.edges} />
          <EventsCard events={detail.events} />
        </div>
      ) : null}
    </>
  );
}
