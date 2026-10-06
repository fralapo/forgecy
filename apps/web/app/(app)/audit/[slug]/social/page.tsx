import { getSocialView, type MetricCard, type MetricOrigin } from "@forgecy/audit";
import { SOCIAL_AREAS, socialChannels, type FindingArea, type SocialChannel } from "@forgecy/core";
import { Badge, Card, CardDescription, CardHeader, CardTitle, cn } from "@forgecy/ui";
import { Sparkles, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/lib/i18n";
import { deleteMetricAction, removeSourceAction, requestSocialAnalysisAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { AddFinding } from "../../_components/add-finding";
import { FindingCard } from "../../_components/finding-card";
import {
  ChannelSettings,
  MetricForm,
  ScreenshotUpload,
  TableImport,
} from "../../_components/social-tools";
import { sectionContext, sourceLinks, toView } from "../../_lib/findings";
import { metricLabelId, sourceStatusVariant } from "../../_lib/labels";
import { fileUrl } from "../../_lib/server";

const cardKeys = [
  "followers",
  "followers_gained",
  "followers_lost",
  "impressions",
  "clicks",
  "ctr",
  "reactions",
  "comments",
  "shares",
  "page_visits",
  "leads",
  "posts_total",
  "frequency",
  "avg_interactions",
  "interaction_rate",
  "formats",
  "cta_share",
  "avg_views",
  "avg_likes",
] as const;
const cardKeyOf = (key: string) => cardKeys.find((k) => k === key) ?? null;

export async function generateMetadata() {
  const t = await getTranslations("audit.social");
  return { title: t("metaTitle") };
}

export default async function SocialPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ channel?: string }>;
}) {
  const { slug } = await params;
  const { channel: channelParam } = await searchParams;
  const { db, audit, readOnly, aiAllowed, rt } = await sectionContext(slug);
  const views = await Promise.all(socialChannels.map((c) => getSocialView(db, audit.id, c)));
  const withProfile = views.filter((v) => v.state);
  const channel: SocialChannel =
    socialChannels.find((c) => c === channelParam) ?? withProfile[0]?.channel ?? "instagram";
  const view = views.find((v) => v.channel === channel)!;
  const [links, shots, files] = await Promise.all([
    sourceLinks(db, view.findings),
    Promise.all(view.screenshots.map(async (s) => ({ ...s, href: await fileUrl(s.storageKey) }))),
    Promise.all(
      view.files.map(async (s) => ({
        ...s,
        href: await fileUrl(s.storageKey, s.fileName ?? "export"),
      })),
    ),
  ]);
  const pendingFile = view.files.find((f) => f.status === "pending");
  const hasData = view.postsCount > 0 || view.metrics.length > 0 || view.screenshots.length > 0;
  const areas = (SOCIAL_AREAS as FindingArea[]).filter(
    (a) => a !== "linkedin_leads" || channel === "linkedin",
  );
  const t = await getTranslations("audit");
  const format = await getFormat();
  const num = (n: number) => format.number(n, { maximumFractionDigits: 2 });
  const cardLabel = (c: MetricCard) => {
    const key = cardKeyOf(c.key);
    if (!key) return c.label;
    return key === "followers" && channel === "linkedin"
      ? t("social.card.label.followersPage")
      : t(`social.card.label.${key}`);
  };
  const cardValue = (c: MetricCard) => {
    if (c.value === null) return t("social.card.unavailable");
    if (!c.shown) return c.display;
    if (c.shown.unit === "perWeek") return t("social.card.perWeek", { value: num(c.shown.value) });
    if (c.shown.unit === "percent")
      return format.number(c.shown.value / 100, { style: "percent", maximumFractionDigits: 2 });
    return num(c.shown.value);
  };
  const originText = (o: MetricOrigin) =>
    o.kind === "file"
      ? t("social.card.file", { name: o.fileName ?? t("social.card.imported") })
      : o.note
        ? t("social.card.sourceWithNote", { source: t(`metricSource.${o.source}`), note: o.note })
        : t(`metricSource.${o.source}`);
  const cardDetail = (c: MetricCard) =>
    c.value === null
      ? c.reasonId
        ? t(`social.card.reason.${c.reasonId}`)
        : c.reason
      : [
          c.origin ? originText(c.origin) : c.source,
          c.date ? format.date(c.date) : null,
          c.derived
            ? t(`social.card.derived.${c.derived.id}`, { count: c.derived.count ?? 0 })
            : c.derivedFrom,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="flex flex-col gap-8">
      <p className="text-body-md text-fg-muted">{t("social.intro")}</p>
      <nav aria-label={t("social.channels")}>
        <ul className="flex flex-wrap gap-2">
          {views.map((v) => (
            <li key={v.channel}>
              <Link
                href={`/audit/${slug}/social?channel=${v.channel}` as Route}
                aria-current={v.channel === channel ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-body-sm",
                  v.channel === channel
                    ? "border-primary text-fg"
                    : "border-subtle text-fg-muted hover:text-fg",
                )}
              >
                {t(`channel.${v.channel}`)}
                {v.state ? (
                  <Badge variant={sourceStatusVariant[v.state.status]}>
                    {t(`sourceStatus.${v.state.status}`)}
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t(`channel.${channel}`)}</CardTitle>
            <CardDescription>
              {view.state?.unavailableReason
                ? rt(view.state.unavailableRef, view.state.unavailableReason)
                : view.state
                  ? t("social.addData")
                  : t("social.notListed")}
            </CardDescription>
          </CardHeader>
          {!readOnly ? (
            <ChannelSettings
              auditId={audit.id}
              channel={channel}
              profileUrl={view.state?.profileUrl ?? null}
              status={view.state?.status ?? null}
            />
          ) : null}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("social.metrics")}</CardTitle>
            <CardDescription>
              {channel === "linkedin" ? t("social.linkedinHint") : t("social.rateHint")}
            </CardDescription>
          </CardHeader>
          <dl className="grid gap-3 sm:grid-cols-2">
            {view.cards.map((c) => (
              <div key={c.key} className="rounded-md border border-subtle p-3">
                <dt className="text-label text-fg-muted">{cardLabel(c)}</dt>
                <dd
                  className={cn("text-heading-sm", c.value === null ? "text-fg-muted" : "text-fg")}
                >
                  {cardValue(c)}
                </dd>
                <dd className="text-body-sm text-fg-muted">{cardDetail(c)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      {!readOnly && view.state?.status !== "skipped" && view.state?.status !== "unavailable" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("social.enterValue")}</CardTitle>
            </CardHeader>
            <MetricForm auditId={audit.id} channel={channel} />
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("social.uploadData")}</CardTitle>
            </CardHeader>
            <TableImport
              auditId={audit.id}
              channel={channel}
              {...(pendingFile ? { pendingSourceId: pendingFile.id } : {})}
            />
            <ScreenshotUpload auditId={audit.id} channel={channel} />
          </Card>
        </div>
      ) : null}

      {view.metrics.length || files.length || shots.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("social.collected")}</CardTitle>
            <CardDescription>{t("social.collectedDescription")}</CardDescription>
          </CardHeader>
          {view.metrics.length ? (
            <ul className="flex flex-col divide-y divide-subtle">
              {view.metrics.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-body-sm"
                >
                  <span>
                    {t.rich("social.metricValue", {
                      label: metricLabelId(m.metric)
                        ? t(`metric.${metricLabelId(m.metric)!}`)
                        : m.metric,
                      value: num(m.value),
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
                    <span className="text-fg-muted">
                      {" "}
                      · {format.date(m.observedOn)} · {t(`metricSource.${m.source}`)}
                      {m.sourceNote ? ` (${m.sourceNote})` : ""}
                    </span>
                  </span>
                  {!readOnly && !m.sourceId ? (
                    <ActionButton
                      action={deleteMetricAction.bind(null, m.id)}
                      icon={<Trash2 aria-hidden />}
                      variant="ghost"
                      size="sm"
                    >
                      {t("social.remove")}
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {files.length ? (
            <ul className="flex flex-col divide-y divide-subtle">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-body-sm"
                >
                  <span>
                    {f.href ? (
                      <a href={f.href} className="text-link underline">
                        {f.fileName}
                      </a>
                    ) : (
                      f.fileName
                    )}
                    <span className="text-fg-muted">
                      {" "}
                      ·{" "}
                      {f.status === "pending"
                        ? t("social.toImport")
                        : f.data.rowsSkipped
                          ? t("social.rowsImportedSkipped", {
                              count: f.data.rowsImported ?? 0,
                              skipped: f.data.rowsSkipped,
                            })
                          : t("social.rowsImported", { count: f.data.rowsImported ?? 0 })}
                    </span>
                  </span>
                  {!readOnly ? (
                    <ActionButton
                      action={removeSourceAction.bind(null, f.id)}
                      icon={<Trash2 aria-hidden />}
                      variant="ghost"
                      size="sm"
                      confirm={t("social.removeFileConfirm")}
                    >
                      {t("social.remove")}
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {shots.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {shots.map((s) => (
                <li key={s.id} className="flex flex-col gap-1">
                  {s.href ? (
                    <a href={s.href} target="_blank" rel="noreferrer noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                      <img
                        src={s.href}
                        alt={t("social.screenshotAlt", { name: s.fileName ?? "" })}
                        className="h-28 w-full rounded-sm border border-subtle object-cover"
                        loading="lazy"
                      />
                    </a>
                  ) : null}
                  <span className="truncate text-body-sm text-fg-muted">{s.fileName}</span>
                  {!readOnly ? (
                    <ActionButton
                      action={removeSourceAction.bind(null, s.id)}
                      icon={<Trash2 aria-hidden />}
                      variant="ghost"
                      size="sm"
                    >
                      {t("social.remove")}
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-heading-md text-fg">{t("social.observations")}</h2>
          <div className="flex flex-wrap items-start gap-2">
            {!readOnly && aiAllowed && hasData ? (
              <ActionButton
                action={requestSocialAnalysisAction.bind(null, audit.id, channel)}
                icon={<Sparkles aria-hidden />}
                variant="primary"
                size="sm"
              >
                {view.findings.some((f) => f.authorAgent)
                  ? t("social.regenerate")
                  : t("social.generate")}
              </ActionButton>
            ) : null}
            {!readOnly ? (
              <AddFinding
                auditId={audit.id}
                channel={channel}
                areas={areas}
                sources={view.screenshots.map((s) => ({
                  id: s.id,
                  label: s.fileName ?? t("social.screenshot"),
                  type: "screenshot" as const,
                }))}
              />
            ) : null}
          </div>
        </div>
        {aiAllowed ? <p className="text-body-sm text-fg-muted">{t("social.aiHint")}</p> : null}
        {view.findings.length ? (
          view.findings.map((f) => (
            <FindingCard key={f.id} finding={toView(f, rt)} sources={links} readOnly={readOnly} />
          ))
        ) : (
          <p className="text-body-md text-fg-muted">{t("social.noObservations")}</p>
        )}
      </section>
    </div>
  );
}
