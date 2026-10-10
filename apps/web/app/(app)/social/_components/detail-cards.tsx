import { cn, Badge, Card, CardHeader, CardTitle } from "@forgecy/ui";
import {
  edgeKinds,
  mediaKinds,
  type Basis,
  type ProfileAnalysis,
  type ProfileDetail,
  type Summary,
} from "@forgecy/social";
import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { describeEvent, postUrl, profileUrl } from "../_lib/events";
import { heatClass, heatLevel, heatmapMax, hourLabel, weekdayKeys } from "../_lib/heat";
import { getFormat } from "@/lib/i18n";

/** Where the numbers of a card come from: how many posts and which period. */
async function BasisLine({ basis, text }: { basis: Basis; text?: string }) {
  const t = await getTranslations("social.cards");
  const format = await getFormat();
  return (
    <p className="text-body-sm text-fg-muted">
      {text ??
        (basis.postsUsed === 0 || !basis.from || !basis.to
          ? t("basisNone")
          : t("basis", {
              count: basis.postsUsed,
              from: format.date(basis.from),
              to: format.date(basis.to),
            }))}
    </p>
  );
}

async function SectionCard({
  title,
  basis,
  basisText,
  className,
  children,
}: {
  title: string;
  basis?: Basis;
  basisText?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {basis ? <BasisLine basis={basis} {...(basisText ? { text: basisText } : {})} /> : null}
      </CardHeader>
      {children}
    </Card>
  );
}

/** Text for a number that may be missing: never an invented value. */
async function numberOrNA() {
  const t = await getTranslations("social");
  const format = await getFormat();
  return (value: number | null | undefined, digits = 0): string =>
    value === null || value === undefined
      ? t("unavailable")
      : format.number(value, { maximumFractionDigits: digits });
}

export async function MixCard({ analysis }: { analysis: ProfileAnalysis }) {
  const t = await getTranslations("social");
  const format = await getFormat();
  const num = await numberOrNA();
  const { mix, basis } = analysis;
  return (
    <SectionCard title={t("cards.mix.title")} basis={basis}>
      <ul className="space-y-3">
        {mediaKinds.map((kind) => {
          const k = mix.byKind[kind];
          return (
            <li key={kind} className="space-y-1">
              <div className="flex flex-wrap justify-between gap-x-4 text-body-sm">
                <span className="text-fg">{t(`cards.mix.kinds.${kind}`)}</span>
                <span className="text-fg-muted">
                  {format.percent(k.share)}
                  {" · "}
                  {t("cards.mix.average", { value: num(k.avgInteractions) })}
                </span>
              </div>
              <div aria-hidden className="h-2 overflow-hidden rounded-sm bg-app">
                <div className="h-full bg-primary" style={{ width: `${k.share * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <ul className="space-y-1 text-body-sm text-fg-muted">
        <li>{t("cards.mix.sponsored", { share: format.percent(mix.sponsoredShare) })}</li>
        <li>{t("cards.mix.collab", { share: format.percent(mix.collabShare) })}</li>
        {mix.avgCarouselSlides !== null ? (
          <li>{t("cards.mix.slides", { value: num(mix.avgCarouselSlides, 1) })}</li>
        ) : null}
      </ul>
    </SectionCard>
  );
}

export async function CadenceCard({ analysis }: { analysis: ProfileAnalysis }) {
  const t = await getTranslations("social");
  const format = await getFormat();
  const num = await numberOrNA();
  const { cadence, basis } = analysis;
  const max = heatmapMax(cadence.heatmap);
  const weekday = (i: number) => t(`cards.cadence.weekdays.${weekdayKeys[i] ?? "mon"}`);
  const slots = cadence.bestSlots.map((s) =>
    t("cards.cadence.slot", {
      weekday: weekday(s.weekday),
      hour: hourLabel(s.hour),
      count: s.count,
    }),
  );
  return (
    <SectionCard title={t("cards.cadence.title")} basis={basis} className="lg:col-span-2">
      <ul className="grid gap-1 text-body-sm text-fg sm:grid-cols-3">
        <li>
          {cadence.postsPerWeek === null
            ? t("unavailable")
            : t("cards.cadence.perWeek", { value: num(cadence.postsPerWeek, 1) })}
        </li>
        <li>
          {cadence.medianGapHours === null
            ? t("unavailable")
            : t("cards.cadence.gap", { value: num(cadence.medianGapHours, 0) })}
        </li>
        <li>
          {t("cards.cadence.lastPost", {
            when: cadence.lastPostAt ? format.relative(cadence.lastPostAt) : t("unavailable"),
          })}
        </li>
      </ul>
      <div className="overflow-x-auto">
        <div
          role="img"
          aria-label={t("cards.cadence.heatmap", { timeZone: cadence.timeZone })}
          className="min-w-xl space-y-0.5"
        >
          <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-0.5 text-label text-fg-muted">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center">
                {h % 3 === 0 ? h : ""}
              </span>
            ))}
          </div>
          {cadence.heatmap.map((row, day) => (
            <div
              key={day}
              className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] items-center gap-0.5"
            >
              <span className="text-label text-fg-muted">{weekday(day)}</span>
              {row.map((count, hour) => (
                <span
                  key={hour}
                  title={t("cards.cadence.cell", {
                    weekday: weekday(day),
                    hour: hourLabel(hour),
                    count,
                  })}
                  className={cn(
                    "h-5 rounded-sm border border-subtle",
                    heatClass[heatLevel(count, max)],
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="flex items-center gap-2 text-label text-fg-muted">
        <span>{t("cards.cadence.less")}</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span
            key={level}
            className={cn("size-4 rounded-sm border border-subtle", heatClass[level])}
          />
        ))}
        <span>{t("cards.cadence.more")}</span>
      </div>
      <p className="text-body-sm text-fg">
        {slots.length
          ? t("cards.cadence.best", { slots: format.list(slots) })
          : t("cards.cadence.noBest")}
      </p>
    </SectionCard>
  );
}

export async function HashtagsCard({ analysis }: { analysis: ProfileAnalysis }) {
  const t = await getTranslations("social");
  const num = await numberOrNA();
  const { hashtags, basis } = analysis;
  return (
    <SectionCard title={t("cards.hashtags.title")} basis={basis}>
      {hashtags.top.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{t("cards.hashtags.none")}</p>
      ) : (
        <>
          <p className="text-body-sm text-fg-muted">
            {t("cards.hashtags.summary", {
              withTags: hashtags.postsWithHashtags,
              avg: num(hashtags.avgPerPost, 1),
              distinct: hashtags.distinct,
            })}
          </p>
          <ul className="space-y-1 text-body-sm">
            {hashtags.top.slice(0, 10).map((h) => (
              <li key={h.tag} className="flex flex-wrap justify-between gap-x-4">
                <span className="text-fg">#{h.tag}</span>
                <span className="text-fg-muted">
                  {t("cards.hashtags.uses", { count: h.count })}
                  {" · "}
                  {t("cards.hashtags.average", { value: num(h.avgInteractions) })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

const SUMMARY_ROWS = ["interactions", "likes", "comments"] as const;
const SUMMARY_COLUMNS = ["min", "median", "mean", "max"] as const;

export async function EngagementCard({ analysis }: { analysis: ProfileAnalysis }) {
  const t = await getTranslations("social");
  const format = await getFormat();
  const num = await numberOrNA();
  const { engagement, basis } = analysis;
  const summaries: Record<(typeof SUMMARY_ROWS)[number], Summary | null> = {
    interactions: engagement.interactions,
    likes: engagement.likes,
    comments: engagement.comments,
  };
  const rate = (v: number | null) =>
    v === null ? t("unavailable") : t("cards.engagement.rateValue", { value: num(v, 2) });
  const postList = (title: string, posts: typeof engagement.top) =>
    posts.length ? (
      <div className="space-y-2">
        <h4 className="text-body-sm font-medium text-fg">{title}</h4>
        <ul className="space-y-2">
          {posts.map((p) => {
            const url = postUrl(p.shortcode);
            return (
              <li key={p.id} className="text-body-sm">
                <p className="text-fg">{p.captionStart ?? t("cards.engagement.noCaption")}</p>
                <p className="flex flex-wrap items-center gap-x-3 text-fg-muted">
                  <span>{format.date(p.postedAt)}</span>
                  <span>{t("cards.engagement.count", { count: p.interactions })}</span>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-link"
                    >
                      {t("profile.openOnInstagram")}
                      <ExternalLink aria-hidden className="size-4" />
                    </a>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    ) : null;
  return (
    <SectionCard
      title={t("cards.engagement.title")}
      basis={basis}
      basisText={t("cards.basisMetrics", { count: engagement.postsWithMetrics })}
    >
      {engagement.postsWithMetrics === 0 ? (
        <p className="text-body-sm text-fg-muted">{t("cards.engagement.none")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-subtle text-fg-muted">
                  <td />
                  {SUMMARY_COLUMNS.map((c) => (
                    <th key={c} scope="col" className="px-2 py-1 text-right font-medium">
                      {t(`cards.engagement.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SUMMARY_ROWS.map((row) => (
                  <tr key={row} className="border-b border-subtle last:border-b-0">
                    <th scope="row" className="py-1 pr-2 text-left font-normal text-fg">
                      {t(`cards.engagement.${row}`)}
                    </th>
                    {SUMMARY_COLUMNS.map((c) => (
                      <td key={c} className="px-2 py-1 text-right text-fg">
                        {num(summaries[row]?.[c], 1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="grid gap-1 text-body-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">{t("cards.engagement.rate")}</dt>
              <dd className="text-fg">{rate(engagement.ratePct)}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t("cards.engagement.medianRate")}</dt>
              <dd className="text-fg">{rate(engagement.medianRatePct)}</dd>
            </div>
          </dl>
          {postList(t("cards.engagement.top"), engagement.top)}
          {postList(t("cards.engagement.bottom"), engagement.bottom)}
        </>
      )}
    </SectionCard>
  );
}

export async function CaptionsCard({ analysis }: { analysis: ProfileAnalysis }) {
  const t = await getTranslations("social");
  const format = await getFormat();
  const num = await numberOrNA();
  const { captions, basis } = analysis;
  const share = (v: number | null) => (v === null ? t("unavailable") : format.percent(v));
  const rows = [
    [
      t("cards.captions.length"),
      captions.avgLength === null
        ? t("unavailable")
        : t("cards.captions.lengthValue", { value: num(captions.avgLength) }),
    ],
    [
      t("cards.captions.median"),
      captions.medianLength === null
        ? t("unavailable")
        : t("cards.captions.lengthValue", { value: num(captions.medianLength) }),
    ],
    [t("cards.captions.cta"), share(captions.ctaShare)],
    [t("cards.captions.question"), share(captions.questionShare)],
    [t("cards.captions.emoji"), share(captions.emojiShare)],
    [t("cards.captions.avgEmojis"), num(captions.avgEmojis, 1)],
    [t("cards.captions.language"), t(`cards.captions.languages.${captions.language}`)],
  ] as const;
  return (
    <SectionCard title={t("cards.captions.title")} basis={basis}>
      {captions.postsWithCaption === 0 ? (
        <p className="text-body-sm text-fg-muted">{t("cards.captions.none")}</p>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 text-body-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-fg-muted">{label}</dt>
              <dd className="text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </SectionCard>
  );
}

export async function RelationsCard({ edges }: { edges: ProfileDetail["edges"] }) {
  const t = await getTranslations("social");
  const format = await getFormat();
  return (
    <SectionCard title={t("cards.relations.title")}>
      {edges.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{t("cards.relations.none")}</p>
      ) : (
        edgeKinds.map((kind) => {
          const list = edges.filter((e) => e.kind === kind).slice(0, 10);
          if (!list.length) return null;
          return (
            <div key={kind} className="space-y-2">
              <h4 className="text-body-sm font-medium text-fg">
                {t(`cards.relations.kinds.${kind}`)}
              </h4>
              <ul className="space-y-1 text-body-sm">
                {list.map((e) => (
                  <li key={e.dst} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <a
                      href={profileUrl(e.dst)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link"
                    >
                      @{e.dst}
                    </a>
                    <span className="text-fg-muted">
                      {t("cards.relations.times", { count: e.count })}
                      {" · "}
                      {t("cards.relations.last", { date: format.date(e.lastSeen) })}
                    </span>
                    {e.endedAt ? (
                      <Badge>{t("cards.relations.ended", { date: format.date(e.endedAt) })}</Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </SectionCard>
  );
}

const SOURCE_KEYS = ["graph_api", "public_web", "file_import"] as const;

export async function EventsCard({ events }: { events: ProfileDetail["events"] }) {
  const t = await getTranslations("social");
  const format = await getFormat();
  const sourceName = (v: string | null) =>
    SOURCE_KEYS.find((s) => s === v)
      ? t(`sources.${v as (typeof SOURCE_KEYS)[number]}`)
      : (v ?? t("unavailable"));
  const count = (v: string | null) =>
    v === null || Number.isNaN(Number(v)) ? t("unavailable") : format.number(Number(v));
  return (
    <SectionCard title={t("cards.events.title")} className="lg:col-span-2">
      {events.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{t("cards.events.empty")}</p>
      ) : (
        <ul className="divide-y divide-subtle">
          {events.map((e) => {
            const { key, numeric } = describeEvent(e);
            const shortcode = e.type === "new_post" ? e.new : null;
            const url = postUrl(shortcode);
            // The text itself, for fields where the sentence only says that it changed.
            const detail =
              !numeric && /^(biography|external_url|full_name|category)\./.test(key)
                ? (e.new ?? e.old)
                : null;
            const sentence = t(`cards.events.${key}`, {
              old: numeric ? count(e.old) : sourceName(e.old),
              new: numeric ? count(e.new) : sourceName(e.new),
              shortcode: shortcode ?? "",
            });
            return (
              <li key={e.id} className="space-y-1 py-2 text-body-sm">
                <p className="flex flex-wrap items-center gap-x-3">
                  <span className="text-fg-muted">{format.date(e.at, "dateTime")}</span>
                  <span className="text-fg">{sentence}</span>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-link"
                    >
                      {t("profile.openOnInstagram")}
                      <ExternalLink aria-hidden className="size-4" />
                    </a>
                  ) : null}
                </p>
                {detail ? <p className="line-clamp-2 text-fg-muted">{detail}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
