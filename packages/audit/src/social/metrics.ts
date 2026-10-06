import type { MetricSource, SocialChannel } from "@forgecy/core";

export interface MetricRow {
  metric: string;
  value: number;
  observedOn: string;
  source: MetricSource;
  sourceNote?: string | null;
  sourceLabel?: string;
}

export interface PostRow {
  postedOn: string;
  format?: string | null;
  postType?: string | null;
  text?: string | null;
  metrics: Record<string, number>;
  sourceLabel?: string;
}

/** One MetricCard: a value with its source and date, or "Non disponibile" with the reason. */
export interface MetricCard {
  key: string;
  label: string;
  value: number | null;
  display: string;
  reason?: string;
  source?: string;
  date?: string;
  derivedFrom?: string;
}

export const metricSourceLabels: Record<MetricSource, string> = {
  provided_by_prospect: "Fornito dal prospect",
  agency_tool: "Strumento dell'agenzia",
  public_profile: "Letto dal profilo pubblico",
  file_import: "File importato",
  other: "Altro",
};

const fmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function latest(rows: MetricRow[], metric: string): MetricRow | undefined {
  return rows
    .filter((r) => r.metric === metric)
    .sort((a, b) => b.observedOn.localeCompare(a.observedOn))[0];
}

function fromRow(key: string, label: string, row: MetricRow | undefined, reason: string) {
  if (!row) return { key, label, value: null, display: "Non disponibile", reason } as MetricCard;
  return {
    key,
    label,
    value: row.value,
    display: fmt.format(row.value),
    source: row.sourceLabel ?? metricSourceLabels[row.source],
    date: row.observedOn,
  } satisfies MetricCard;
}

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
  const noData = "Nessun dato fornito";
  const cards: MetricCard[] = [];
  const followers = latest(metrics, "followers");
  cards.push(
    fromRow(
      "followers",
      channel === "linkedin" ? "Follower della pagina" : "Follower",
      followers,
      noData,
    ),
  );

  if (channel === "linkedin") {
    for (const [key, label] of [
      ["followers_gained", "Follower acquisiti"],
      ["followers_lost", "Follower persi"],
      ["impressions", "Impressioni"],
      ["clicks", "Clic"],
      ["ctr", "CTR"],
      ["reactions", "Reazioni"],
      ["comments", "Commenti"],
      ["shares", "Condivisioni"],
      ["page_visits", "Visite alla pagina"],
      ["leads", "Lead dichiarati"],
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
                source: posts[0]?.sourceLabel ?? "File importato",
                derivedFrom: `Somma di ${posts.length} post importati`,
              }
            : { key, label, value: null, display: "Non disponibile", reason: noData },
        );
      }
    }
    return cards;
  }

  const postsTotal = latest(metrics, "posts_total");
  cards.push(fromRow("posts_total", "Post totali", postsTotal, noData));

  // Frequency: real dates in the last 4 weeks.
  const from = new Date(today.getTime() - 28 * 86_400_000).toISOString().slice(0, 10);
  const recent = posts.filter(
    (p) => p.postedOn >= from && p.postedOn <= today.toISOString().slice(0, 10),
  );
  cards.push(
    posts.length
      ? {
          key: "frequency",
          label: "Frequenza",
          value: recent.length / 4,
          display: `${fmt.format(recent.length / 4)} post a settimana`,
          source: posts[0]?.sourceLabel ?? "File importato",
          derivedFrom: `${recent.length} post con data nelle ultime 4 settimane`,
        }
      : {
          key: "frequency",
          label: "Frequenza",
          value: null,
          display: "Non disponibile",
          reason: "Nessun post con data",
        },
  );

  const withInteractions = posts.map(interactionsOf).filter((v): v is number => v !== null);
  const avg = withInteractions.length
    ? withInteractions.reduce((a, b) => a + b, 0) / withInteractions.length
    : null;
  cards.push(
    avg !== null
      ? {
          key: "avg_interactions",
          label: "Interazioni medie per post",
          value: avg,
          display: fmt.format(Math.round(avg * 10) / 10),
          source: posts[0]?.sourceLabel ?? "File importato",
          derivedFrom: `Media su ${withInteractions.length} post`,
        }
      : {
          key: "avg_interactions",
          label: "Interazioni medie per post",
          value: null,
          display: "Non disponibile",
          reason: "Nessun post con interazioni",
        },
  );

  // Interaction rate only with followers and interactions from the same source.
  const sameSource =
    followers && avg !== null && followers.source === "file_import" && followers.value > 0;
  cards.push(
    sameSource
      ? {
          key: "interaction_rate",
          label: "Tasso di interazione",
          value: (avg! / followers!.value) * 100,
          display: `${fmt.format(Math.round((avg! / followers!.value) * 10000) / 100)}%`,
          source: followers!.sourceLabel ?? metricSourceLabels[followers!.source],
          derivedFrom: "Calcolato da: interazioni ÷ follower",
        }
      : {
          key: "interaction_rate",
          label: "Tasso di interazione",
          value: null,
          display: "Non disponibile",
          reason: "Servono follower e interazioni dalla stessa fonte e dallo stesso periodo",
        },
  );

  const formats = [
    ...new Set(posts.map((p) => (p.format ?? p.postType ?? "").toLowerCase()).filter(Boolean)),
  ];
  cards.push(
    formats.length
      ? {
          key: "formats",
          label: "Formati usati",
          value: formats.length,
          display: formats.join(", "),
          source: posts[0]?.sourceLabel ?? "File importato",
        }
      : {
          key: "formats",
          label: "Formati usati",
          value: null,
          display: "Non disponibile",
          reason: "Nessun formato nei dati",
        },
  );

  const withText = posts.filter((p) => p.text);
  cards.push(
    withText.length
      ? {
          key: "cta_share",
          label: "Post con CTA",
          value: (withText.filter((p) => CTA_IN_TEXT.test(p.text!)).length / withText.length) * 100,
          display: `${Math.round((withText.filter((p) => CTA_IN_TEXT.test(p.text!)).length / withText.length) * 100)}%`,
          source: posts[0]?.sourceLabel ?? "File importato",
          derivedFrom: `${withText.length} post con testo`,
        }
      : {
          key: "cta_share",
          label: "Post con CTA",
          value: null,
          display: "Non disponibile",
          reason: "Nessun testo dei post nei dati",
        },
  );

  if (channel === "tiktok") {
    for (const [key, label, field] of [
      ["avg_views", "Visualizzazioni medie", "views"],
      ["avg_likes", "Like medi", "likes"],
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
                source: posts[0]?.sourceLabel ?? "File importato",
                derivedFrom: `Media su ${values.length} post`,
              }
            : { key, label, value: null, display: "Non disponibile", reason: noData },
      );
    }
  }
  return cards;
}
