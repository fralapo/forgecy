import type {
  AuditChannel,
  AuditStatus,
  ComparisonOutcome,
  FindingArea,
  FindingStatus,
  Level,
  ReportStatus,
  SourceStatus,
} from "@forgecy/core";

type BadgeVariant = "neutral" | "success" | "warning" | "error" | "info" | "highlight";

export const auditStatusLabel: Record<AuditStatus, string> = {
  draft: "Bozza",
  collecting: "Raccolta dati",
  awaiting_competitors: "Competitor da confermare",
  analyzing: "Analisi in corso",
  in_review: "Da rivedere",
  reviewed: "Rivisto",
  delivered: "Consegnato",
  failed: "Errore",
  archived: "Archiviato",
};

export const auditStatusVariant: Record<AuditStatus, BadgeVariant> = {
  draft: "neutral",
  collecting: "info",
  awaiting_competitors: "warning",
  analyzing: "info",
  in_review: "warning",
  reviewed: "success",
  delivered: "success",
  failed: "error",
  archived: "neutral",
};

export const sourceStatusLabel: Record<SourceStatus, string> = {
  pending: "Da raccogliere",
  collecting: "In raccolta",
  collected: "Raccolto",
  partial: "Parziale",
  unavailable: "Non disponibile",
  skipped: "Saltato",
  failed: "Errore",
};

export const sourceStatusVariant: Record<SourceStatus, BadgeVariant> = {
  pending: "neutral",
  collecting: "info",
  collected: "success",
  partial: "warning",
  unavailable: "neutral",
  skipped: "neutral",
  failed: "error",
};

export const channelLabel: Record<AuditChannel, string> = {
  website: "Sito web",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
};

export const areaLabel: Record<FindingArea, string> = {
  message: "Messaggio e posizionamento",
  visual: "Identità visiva",
  ux: "Esperienza e conversione",
  seo_accessibility: "SEO e accessibilità",
  social_visual: "Stile visivo",
  social_tone: "Tono di voce",
  social_cta: "Call to action",
  social_formats: "Formati e frequenza",
  linkedin_leads: "LinkedIn e contatti",
  competitors: "Competitor",
  cross_channel: "Tra i canali",
};

export const findingStatusLabel: Record<FindingStatus, string> = {
  observed: "Da rivedere",
  accepted: "Accettata",
  edited: "Modificata",
  rejected: "Scartata",
};

export const findingStatusVariant: Record<FindingStatus, BadgeVariant> = {
  observed: "highlight",
  accepted: "success",
  edited: "success",
  rejected: "neutral",
};

export const levelLabel: Record<Level, string> = { high: "Alta", medium: "Media", low: "Bassa" };

export const outcomeLabel: Record<ComparisonOutcome, string> = {
  consistent: "Coerente",
  partial: "Coerenza parziale",
  to_align: "Da allineare",
  opportunity: "Opportunità",
};

export const outcomeVariant: Record<ComparisonOutcome, BadgeVariant> = {
  consistent: "success",
  partial: "warning",
  to_align: "error",
  opportunity: "info",
};

export const agentLabel: Record<string, string> = {
  brand_analyst: "Brand Analyst",
  strategist: "Strategist",
  copywriter: "Copywriter",
};

export const jobLabel: Record<string, string> = {
  "audit.crawl": "Lettura del sito",
  "audit.analyze_site": "Osservazioni sul sito",
  "audit.analyze_social": "Osservazioni sui social",
  "audit.propose_competitors": "Proposta dei competitor",
  "audit.compare_competitors": "Confronto con i competitor",
  "audit.compare_channels": "Confronto tra i canali",
  "audit.diagnose": "Diagnosi",
  "audit.plan": "Piano di 30 giorni",
  "audit.report_texts": "Testi del report",
  "audit.report_export": "PDF del report",
};

export const stepLabel: Record<string, string> = {
  robots: "robots.txt",
  discovery: "Scelta delle pagine",
  screenshots: "Screenshot desktop e mobile",
  extraction: "Testi, colori, font e CTA",
  checks: "Controlli tecnici",
  analysis: "Osservazioni dell'AI",
};

export const metricLabel: Record<string, string> = {
  followers: "Follower",
  posts_total: "Post totali",
  followers_gained: "Follower acquisiti",
  followers_lost: "Follower persi",
  impressions: "Impressioni",
  clicks: "Clic",
  ctr: "CTR (%)",
  reactions: "Reazioni",
  comments: "Commenti",
  shares: "Condivisioni",
  page_visits: "Visite alla pagina",
  leads: "Lead dichiarati",
  avg_views: "Visualizzazioni medie",
  avg_likes: "Like medi",
};

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export const reportStatusLabel: Record<ReportStatus, string> = {
  draft: "Bozza",
  in_review: "In revisione",
  approved: "Approvato",
  exported: "Esportato",
  superseded: "Sostituito",
};

export const reportStatusVariant: Record<ReportStatus, BadgeVariant> = {
  draft: "neutral",
  in_review: "info",
  approved: "success",
  exported: "success",
  superseded: "neutral",
};
