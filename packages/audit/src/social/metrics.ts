import type { MetricSource, SocialChannel } from "@forgecy/core";

/** Where a value comes from, as data the interface words in the user's language. */
export type MetricOrigin =
  | { kind: "file"; fileName: string | null }
  /** A public-profile reading copied into the audit: stored like a file, but not one. */
  | { kind: "profile"; name: string | null }
  | { kind: "source"; source: MetricSource; note?: string | null };

/** Origin of rows that belong to an audit source: a profile reading (`public_page`) or a file. */
export function sourceOrigin(s: { method?: string | null; fileName: string | null }): MetricOrigin {
  return s.method === "public_page"
    ? { kind: "profile", name: s.fileName }
    : { kind: "file", fileName: s.fileName };
}

/** English form of `sourceOrigin` for prompts and logs. */
export function sourceOriginLabel(
  s: { method?: string | null; fileName: string | null },
  fallback: string,
): string {
  return `${s.method === "public_page" ? "Public profile" : "File"}: ${s.fileName ?? fallback}`;
}

export interface MetricRow {
  metric: string;
  value: number;
  observedOn: string;
  source: MetricSource;
  sourceNote?: string | null;
  sourceLabel?: string;
  origin?: MetricOrigin;
}

export interface PostRow {
  postedOn: string;
  format?: string | null;
  postType?: string | null;
  text?: string | null;
  metrics: Record<string, number>;
  sourceLabel?: string;
  origin?: MetricOrigin;
}

export type MetricReasonId =
  "noData" | "noDatedPosts" | "noInteractions" | "needsSameSource" | "noFormats" | "noText";

export type MetricDerivationId =
  "sumPosts" | "datedPosts" | "averagePosts" | "rateFormula" | "postsWithText";

/**
 * One MetricCard: a value with its source and date, or "Unavailable" with the reason.
 * `label`, `display`, `reason`, `source` and `derivedFrom` are English (prompts, logs);
 * the ids, `shown`, `origin` and `derived` let the interface word them in any language.
 */
export interface MetricCard {
  key: string;
  label: string;
  value: number | null;
  display: string;
  reason?: string;
  reasonId?: MetricReasonId;
  /** The rounded number shown, with its unit (absent for lists such as formats). */
  shown?: { value: number; unit?: "perWeek" | "percent" };
  source?: string;
  origin?: MetricOrigin;
  date?: string;
  derivedFrom?: string;
  derived?: { id: MetricDerivationId; count?: number };
}

export const metricSourceLabels: Record<MetricSource, string> = {
  provided_by_prospect: "Provided by the prospect",
  agency_tool: "Agency tool",
  public_profile: "Read from the public profile",
  file_import: "Imported file",
  other: "Other",
};

const fmt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

function latest(rows: MetricRow[], metric: string): MetricRow | undefined {
  return rows
    .filter((r) => r.metric === metric)
    .sort((a, b) => b.observedOn.localeCompare(a.observedOn))[0];
}

const originOfRow = (row: MetricRow): MetricOrigin =>
  row.origin ?? { kind: "source", source: row.source, note: row.sourceNote ?? null };
const originOfPosts = (posts: PostRow[]): MetricOrigin =>
  posts[0]?.origin ?? { kind: "file", fileName: null };

function unavailable(key: string, label: string, reason: string, reasonId: MetricReasonId) {
  return { key, label, value: null, display: "Unavailable", reason, reasonId } as MetricCard;
}

function fromRow(key: string, label: string, row: MetricRow | undefined, reason: string) {
  if (!row) return unavailable(key, label, reason, "noData");
  return {
    key,
    label,
    value: row.value,
    display: fmt.format(row.value),
    shown: { value: row.value },
    source: row.sourceLabel ?? metricSourceLabels[row.source],
    origin: originOfRow(row),
    date: row.observedOn,
  } satisfies MetricCard;
}

// Italian and English CTA phrases: client posts are mostly Italian.
const CTA_IN_TEXT =
  /\b(link in bio|scopri|contatt|prenot|acquista|scrivici|chiama|iscriv|scarica|richied|visita|shop now|learn more|book|dm)\b/i;

function interactionsOf(p: PostRow): number | null {
  if (p.metrics.interactions !== undefined) return p.metrics.interactions;
  const parts = ["likes", "comments", "saves", "shares"]
    .map((k) => p.metrics[k])
    .filter((v): v is number => v !== undefined);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

/**
 * Channel metrics from real data only. Frequency uses real post dates of the last
 * 4 weeks; the interaction rate exists only when followers and interactions come
 * from the same source. LinkedIn has its own set and is never compared with Instagram.
 */
export function computeChannelMetrics(input: {
  channel: SocialChannel;
  metrics: MetricRow[];
  posts: PostRow[];
  today?: Date;
}): MetricCard[] {
  const { channel, metrics, posts } = input;
  const today = input.today ?? new Date();
  const noData = "No data provided";
  const cards: MetricCard[] = [];
  const followers = latest(metrics, "followers");
  cards.push(
    fromRow(
      "followers",
      channel === "linkedin" ? "Page followers" : "Followers",
      followers,
      noData,
    ),
  );

  if (channel === "linkedin") {
    for (const [key, label] of [
      ["followers_gained", "Followers gained"],
      ["followers_lost", "Followers lost"],
      ["impressions", "Impressions"],
      ["clicks", "Clicks"],
      ["ctr", "CTR"],
      ["reactions", "Reactions"],
      ["comments", "Comments"],
      ["shares", "Shares"],
      ["page_visits", "Page visits"],
      ["leads", "Reported leads"],
    ] as const) {
      const row = latest(metrics, key);
      if (row) cards.push(fromRow(key, label, row, noData));
      else {
        const sum = posts.reduce(
          (s, p) => s + (p.metrics[key === "reactions" ? "likes" : key] ?? 0),
          0,
        );
        const has = posts.some((p) => p.metrics[key === "reactions" ? "likes" : key] !== undefined);
        cards.push(
          has && key !== "ctr"
            ? {
                key,
                label,
                value: sum,
                display: fmt.format(sum),
                shown: { value: sum },
                source: posts[0]?.sourceLabel ?? "Imported file",
                origin: originOfPosts(posts),
                derivedFrom: `Sum of ${posts.length} imported posts`,
                derived: { id: "sumPosts", count: posts.length },
              }
            : unavailable(key, label, noData, "noData"),
        );
      }
    }
    return cards;
  }

  const postsTotal = latest(metrics, "posts_total");
  cards.push(fromRow("posts_total", "Total posts", postsTotal, noData));

  // Frequency: real dates in the last 4 weeks.
  const from = new Date(today.getTime() - 28 * 86_400_000).toISOString().slice(0, 10);
  const recent = posts.filter(
    (p) => p.postedOn >= from && p.postedOn <= today.toISOString().slice(0, 10),
  );
  cards.push(
    posts.length
      ? {
          key: "frequency",
          label: "Frequency",
          value: recent.length / 4,
          display: `${fmt.format(recent.length / 4)} posts a week`,
          shown: { value: recent.length / 4, unit: "perWeek" },
          source: posts[0]?.sourceLabel ?? "Imported file",
          origin: originOfPosts(posts),
          derivedFrom: `${recent.length} dated posts in the last 4 weeks`,
          derived: { id: "datedPosts", count: recent.length },
        }
      : unavailable("frequency", "Frequency", "No dated posts", "noDatedPosts"),
  );

  const withInteractions = posts.map(interactionsOf).filter((v): v is number => v !== null);
  const avg = withInteractions.length
    ? withInteractions.reduce((a, b) => a + b, 0) / withInteractions.length
    : null;
  cards.push(
    avg !== null
      ? {
          key: "avg_interactions",
          label: "Average interactions per post",
          value: avg,
          display: fmt.format(Math.round(avg * 10) / 10),
          shown: { value: Math.round(avg * 10) / 10 },
          source: posts[0]?.sourceLabel ?? "Imported file",
          origin: originOfPosts(posts),
          derivedFrom: `Average over ${withInteractions.length} posts`,
          derived: { id: "averagePosts", count: withInteractions.length },
        }
      : unavailable(
          "avg_interactions",
          "Average interactions per post",
          "No posts with interactions",
          "noInteractions",
        ),
  );

  // Interaction rate only with followers and interactions from the same source.
  const sameSource =
    followers && avg !== null && followers.source === "file_import" && followers.value > 0;
  cards.push(
    sameSource
      ? {
          key: "interaction_rate",
          label: "Interaction rate",
          value: (avg! / followers!.value) * 100,
          display: `${fmt.format(Math.round((avg! / followers!.value) * 10000) / 100)}%`,
          shown: {
            value: Math.round((avg! / followers!.value) * 10000) / 100,
            unit: "percent",
          },
          source: followers!.sourceLabel ?? metricSourceLabels[followers!.source],
          origin: originOfRow(followers!),
          derivedFrom: "Calculated as: interactions ÷ followers",
          derived: { id: "rateFormula" },
        }
      : unavailable(
          "interaction_rate",
          "Interaction rate",
          "Needs followers and interactions from the same source and period",
          "needsSameSource",
        ),
  );

  const formats = [
    ...new Set(posts.map((p) => (p.format ?? p.postType ?? "").toLowerCase()).filter(Boolean)),
  ];
  cards.push(
    formats.length
      ? {
          key: "formats",
          label: "Formats used",
          value: formats.length,
          display: formats.join(", "),
          source: posts[0]?.sourceLabel ?? "Imported file",
          origin: originOfPosts(posts),
        }
      : unavailable("formats", "Formats used", "No formats in the data", "noFormats"),
  );

  const withText = posts.filter((p) => p.text);
  cards.push(
    withText.length
      ? {
          key: "cta_share",
          label: "Posts with a CTA",
          value: (withText.filter((p) => CTA_IN_TEXT.test(p.text!)).length / withText.length) * 100,
          display: `${Math.round((withText.filter((p) => CTA_IN_TEXT.test(p.text!)).length / withText.length) * 100)}%`,
          shown: {
            value: Math.round(
              (withText.filter((p) => CTA_IN_TEXT.test(p.text!)).length / withText.length) * 100,
            ),
            unit: "percent",
          },
          source: posts[0]?.sourceLabel ?? "Imported file",
          origin: originOfPosts(posts),
          derivedFrom: `${withText.length} posts with text`,
          derived: { id: "postsWithText", count: withText.length },
        }
      : unavailable("cta_share", "Posts with a CTA", "No post text in the data", "noText"),
  );

  if (channel === "tiktok") {
    for (const [key, label, field] of [
      ["avg_views", "Average views", "views"],
      ["avg_likes", "Average likes", "likes"],
    ] as const) {
      const row = latest(metrics, key);
      const values = posts.map((p) => p.metrics[field]).filter((v): v is number => v !== undefined);
      cards.push(
        row
          ? fromRow(key, label, row, noData)
          : values.length
            ? {
                key,
                label,
                value: values.reduce((a, b) => a + b, 0) / values.length,
                display: fmt.format(Math.round(values.reduce((a, b) => a + b, 0) / values.length)),
                shown: { value: Math.round(values.reduce((a, b) => a + b, 0) / values.length) },
                source: posts[0]?.sourceLabel ?? "Imported file",
                origin: originOfPosts(posts),
                derivedFrom: `Average over ${values.length} posts`,
                derived: { id: "averagePosts", count: values.length },
              }
            : unavailable(key, label, noData, "noData"),
      );
    }
  }
  return cards;
}
