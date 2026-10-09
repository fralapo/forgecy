import {
  canAccessClient,
  comparisonCriteria,
  USABLE_FINDING_STATUSES,
  type Actor,
  type AuditChannel,
  type AuditStatus,
  type MessageRef,
  type SocialChannel,
} from "@forgecy/core";
import {
  and,
  asc,
  auditChannelStates,
  auditCompetitors,
  auditFindings,
  auditMetrics,
  auditPlans,
  audits,
  auditSocialPosts,
  auditSources,
  clients,
  clientScopeWhere,
  desc,
  eq,
  inArray,
  isNull,
  jobs,
  or,
  prospectProfiles,
  siteScans,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { ilike, isNotNull } from "drizzle-orm";
import { AUDIT_JOB_ENTITY, auditDiagnoseJob } from "../jobs";
import { computeChannelMetrics, metricSourceLabels, type MetricCard } from "../social/metrics";
import { currentAudit } from "./audits";
import { loadAudit } from "./common";

export type FindingRow = typeof auditFindings.$inferSelect;
export type SourceRow = typeof auditSources.$inferSelect;
export type ScanRow = typeof siteScans.$inferSelect;
export type CompetitorRow = typeof auditCompetitors.$inferSelect;

export interface ProspectListItem {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
  sector: string | null;
  area: string | null;
  ownerName: string | null;
  archived: boolean;
  auditId: string | null;
  auditStatus: AuditStatus | null;
  toReview: number;
  updatedAt: Date;
}

/** Page 4: prospects with their latest audit and how many findings wait for review. */
export async function listProspects(
  db: Database,
  actor: Actor,
  filter: { q?: string; archived?: boolean; status?: AuditStatus | "none" } = {},
): Promise<ProspectListItem[]> {
  const q = filter.q?.trim();
  const latest = db
    .selectDistinctOn([audits.clientId], {
      clientId: audits.clientId,
      id: audits.id,
      status: audits.status,
      updatedAt: audits.updatedAt,
    })
    .from(audits)
    .orderBy(audits.clientId, desc(audits.createdAt))
    .as("latest");
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      websiteUrl: clients.websiteUrl,
      sector: clients.sector,
      area: prospectProfiles.area,
      ownerName: users.name,
      archivedAt: clients.archivedAt,
      auditId: latest.id,
      auditStatus: latest.status,
      auditUpdatedAt: latest.updatedAt,
      updatedAt: clients.updatedAt,
    })
    .from(clients)
    .leftJoin(prospectProfiles, eq(prospectProfiles.clientId, clients.id))
    .leftJoin(users, eq(users.id, prospectProfiles.ownerId))
    .leftJoin(latest, eq(latest.clientId, clients.id))
    .where(
      and(
        eq(clients.status, "prospect"),
        clientScopeWhere(actor, clients.id),
        filter.archived ? isNotNull(clients.archivedAt) : isNull(clients.archivedAt),
        q
          ? or(
              ilike(clients.name, `%${q}%`),
              ilike(clients.websiteUrl, `%${q}%`),
              ilike(clients.sector, `%${q}%`),
            )
          : undefined,
        filter.status === "none"
          ? isNull(latest.id)
          : filter.status
            ? eq(latest.status, filter.status)
            : undefined,
      ),
    )
    .orderBy(
      desc(
        sql`greatest(${clients.updatedAt}, coalesce(${latest.updatedAt}, ${clients.updatedAt}))`,
      ),
    )
    .limit(200);
  const auditIds = rows.map((r) => r.auditId).filter((id): id is string => !!id);
  const pending = auditIds.length
    ? await db
        .select({ auditId: auditFindings.auditId, n: sql<number>`count(*)::int` })
        .from(auditFindings)
        .where(and(inArray(auditFindings.auditId, auditIds), eq(auditFindings.status, "observed")))
        .groupBy(auditFindings.auditId)
    : [];
  const pendingBy = new Map(pending.map((p) => [p.auditId, p.n]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    websiteUrl: r.websiteUrl,
    sector: r.sector,
    area: r.area,
    ownerName: r.ownerName,
    archived: Boolean(r.archivedAt),
    auditId: r.auditId,
    auditStatus: r.auditStatus,
    toReview: r.auditId ? (pendingBy.get(r.auditId) ?? 0) : 0,
    updatedAt: r.auditUpdatedAt && r.auditUpdatedAt > r.updatedAt ? r.auditUpdatedAt : r.updatedAt,
  }));
}

/**
 * A prospect and its current audit. A prospect converted to client keeps its audit pages as
 * history (the client page links to them); a client that never had an audit has none.
 */
export async function getProspectBySlug(db: Database, actor: Actor, slug: string) {
  const client = await db.query.clients.findFirst({ where: eq(clients.slug, slug) });
  // A client the actor may not open is reported like one that does not exist (ADR 0020).
  if (!client || !canAccessClient(actor, client.id)) return null;
  const audit = await currentAudit(db, client.id);
  if (client.status !== "prospect" && !audit) return null;
  const profile = await db.query.prospectProfiles.findFirst({
    where: eq(prospectProfiles.clientId, client.id),
  });
  return { client, profile: profile ?? null, audit };
}

export interface AuditJobState {
  id: string;
  kind: string;
  status: string;
  progress: number;
  error: string | null;
  errorRef: MessageRef | null;
  createdAt: Date;
}

/** Latest job of each kind for the audit (for "in progress", errors and retries). */
export async function auditJobStates(db: Database, auditId: string): Promise<AuditJobState[]> {
  return db
    .selectDistinctOn([jobs.kind], {
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      progress: jobs.progress,
      error: jobs.error,
      errorRef: jobs.errorRef,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(and(eq(jobs.entity, AUDIT_JOB_ENTITY), eq(jobs.entityId, auditId)))
    .orderBy(jobs.kind, desc(jobs.createdAt));
}

/** Prospect site scans, newest first (competitor scans excluded). */
export async function prospectScans(db: Database, auditId: string): Promise<ScanRow[]> {
  return db
    .select()
    .from(siteScans)
    .where(and(eq(siteScans.auditId, auditId), isNull(siteScans.competitorId)))
    .orderBy(desc(siteScans.createdAt));
}

/** Channels with usable data: site pages read, or imported posts / typed metrics. */
export async function channelsWithData(db: Database, auditId: string): Promise<AuditChannel[]> {
  const out: AuditChannel[] = [];
  const [scan] = await prospectScans(db, auditId);
  if (scan && (scan.status === "collected" || scan.status === "partial")) out.push("website");
  const posts = await db
    .selectDistinct({ channel: auditSocialPosts.channel })
    .from(auditSocialPosts)
    .where(eq(auditSocialPosts.auditId, auditId));
  const metrics = await db
    .selectDistinct({ channel: auditMetrics.channel })
    .from(auditMetrics)
    .where(eq(auditMetrics.auditId, auditId));
  for (const c of new Set([...posts, ...metrics].map((r) => r.channel))) out.push(c);
  return out;
}

export async function findingsOf(
  db: Database,
  auditId: string,
  where: { kind?: FindingRow["kind"]; channel?: AuditChannel; areas?: readonly string[] } = {},
): Promise<FindingRow[]> {
  return db
    .select()
    .from(auditFindings)
    .where(
      and(
        eq(auditFindings.auditId, auditId),
        where.kind ? eq(auditFindings.kind, where.kind) : undefined,
        where.channel ? eq(auditFindings.channel, where.channel) : undefined,
        where.areas?.length
          ? inArray(auditFindings.area, where.areas as FindingRow["area"][])
          : undefined,
      ),
    )
    .orderBy(asc(auditFindings.position), asc(auditFindings.createdAt));
}

/** Page 6 overview: channel states, counts, the steps still open. */
export async function getAuditOverview(db: Database, auditId: string) {
  const { audit, client } = await loadAudit(db, auditId);
  const [channels, scans, competitors, counts, jobStates, plan] = await Promise.all([
    db.select().from(auditChannelStates).where(eq(auditChannelStates.auditId, auditId)),
    prospectScans(db, auditId),
    db
      .select()
      .from(auditCompetitors)
      .where(eq(auditCompetitors.auditId, auditId))
      .orderBy(asc(auditCompetitors.position)),
    db
      .select({
        kind: auditFindings.kind,
        status: auditFindings.status,
        n: sql<number>`count(*)::int`,
      })
      .from(auditFindings)
      .where(eq(auditFindings.auditId, auditId))
      .groupBy(auditFindings.kind, auditFindings.status),
    auditJobStates(db, auditId),
    db.query.auditPlans.findFirst({ where: eq(auditPlans.auditId, auditId) }),
  ]);
  const count = (kind: string, statuses?: readonly string[]) =>
    counts
      .filter((c) => c.kind === kind && (!statuses || statuses.includes(c.status)))
      .reduce((s, c) => s + c.n, 0);
  return {
    audit,
    client,
    channels,
    scan: scans[0] ?? null,
    competitors,
    jobs: jobStates,
    plan: plan ?? null,
    counts: {
      observations: count("observation"),
      observationsToReview: count("observation", ["observed"]),
      observationsUsable: count("observation", USABLE_FINDING_STATUSES),
      comparison: count("comparison"),
      problems: count("problem", USABLE_FINDING_STATUSES),
      problemsProposed: count("problem", ["observed"]),
    },
  };
}

export async function getSiteView(db: Database, auditId: string) {
  const scans = await prospectScans(db, auditId);
  const scan = scans[0] ?? null;
  const pages = scan
    ? await db
        .select()
        .from(auditSources)
        .where(eq(auditSources.scanId, scan.id))
        .orderBy(asc(auditSources.createdAt))
    : [];
  const findings = await findingsOf(db, auditId, { kind: "observation", channel: "website" });
  return { scan, previousScans: scans.slice(1), pages, findings };
}

export interface SocialChannelView {
  channel: SocialChannel;
  state: typeof auditChannelStates.$inferSelect | null;
  screenshots: SourceRow[];
  files: SourceRow[];
  metrics: Array<typeof auditMetrics.$inferSelect>;
  cards: MetricCard[];
  postsCount: number;
  findings: FindingRow[];
}

export async function getSocialView(
  db: Database,
  auditId: string,
  channel: SocialChannel,
): Promise<SocialChannelView> {
  const [state, sources, metrics, posts, findings] = await Promise.all([
    db.query.auditChannelStates.findFirst({
      where: and(eq(auditChannelStates.auditId, auditId), eq(auditChannelStates.channel, channel)),
    }),
    db
      .select()
      .from(auditSources)
      .where(and(eq(auditSources.auditId, auditId), eq(auditSources.channel, channel)))
      .orderBy(desc(auditSources.createdAt)),
    db
      .select()
      .from(auditMetrics)
      .where(and(eq(auditMetrics.auditId, auditId), eq(auditMetrics.channel, channel)))
      .orderBy(desc(auditMetrics.observedOn)),
    db
      .select()
      .from(auditSocialPosts)
      .where(and(eq(auditSocialPosts.auditId, auditId), eq(auditSocialPosts.channel, channel)))
      .orderBy(desc(auditSocialPosts.postedOn))
      .limit(500),
    findingsOf(db, auditId, { kind: "observation", channel }),
  ]);
  const fileNames = new Map(sources.map((s) => [s.id, s.fileName ?? "Imported file"]));
  const sourceNames = new Map(sources.map((s) => [s.id, s.fileName]));
  const cards = computeChannelMetrics({
    channel,
    metrics: metrics.map((m) => ({
      metric: m.metric,
      value: m.value,
      observedOn: m.observedOn,
      source: m.source,
      sourceNote: m.sourceNote,
      sourceLabel: m.sourceId
        ? `File: ${fileNames.get(m.sourceId) ?? "imported"}`
        : `${metricSourceLabels[m.source]}${m.sourceNote ? ` · ${m.sourceNote}` : ""}`,
      origin: m.sourceId
        ? { kind: "file" as const, fileName: sourceNames.get(m.sourceId) ?? null }
        : { kind: "source" as const, source: m.source, note: m.sourceNote },
    })),
    posts: posts.map((p) => ({
      postedOn: p.postedOn,
      format: p.format,
      postType: p.postType,
      text: p.text,
      metrics: p.metrics,
      sourceLabel: `File: ${fileNames.get(p.sourceId) ?? "importato"}`,
      origin: { kind: "file" as const, fileName: sourceNames.get(p.sourceId) ?? null },
    })),
  });
  return {
    channel,
    state: state ?? null,
    screenshots: sources.filter((s) => s.kind === "screenshot"),
    files: sources.filter((s) => s.kind === "file"),
    metrics,
    cards,
    postsCount: posts.length,
    findings,
  };
}

export async function getCompetitorView(db: Database, auditId: string) {
  const [competitors, scans, findings] = await Promise.all([
    db
      .select()
      .from(auditCompetitors)
      .where(eq(auditCompetitors.auditId, auditId))
      .orderBy(asc(auditCompetitors.position), asc(auditCompetitors.createdAt)),
    db
      .select()
      .from(siteScans)
      .where(and(eq(siteScans.auditId, auditId), isNotNull(siteScans.competitorId)))
      .orderBy(desc(siteScans.createdAt)),
    findingsOf(db, auditId, { areas: ["competitors"] }),
  ]);
  const latestScan = new Map<string, ScanRow>();
  for (const s of scans)
    if (s.competitorId && !latestScan.has(s.competitorId)) latestScan.set(s.competitorId, s);
  const [prospectScan] = await prospectScans(db, auditId);
  return { competitors, latestScan, prospectScan: prospectScan ?? null, findings };
}

export async function getComparisonView(db: Database, auditId: string) {
  const rows = await findingsOf(db, auditId, { kind: "comparison" });
  const order = new Map(comparisonCriteria.map((c, i) => [c, i]));
  return rows
    .filter((r) => r.status !== "rejected")
    .sort(
      (a, b) =>
        (order.get(a.comparison?.criterion ?? "color") ?? 0) -
        (order.get(b.comparison?.criterion ?? "color") ?? 0),
    );
}

/** Outcome of the latest completed diagnosis job, from its stored result. */
export interface DiagnosisOutcome {
  proposed: number;
  kept: number;
  withoutEvidence: number;
}

async function lastDiagnosisOutcome(
  db: Database,
  auditId: string,
): Promise<DiagnosisOutcome | null> {
  const [row] = await db
    .select({ result: jobs.result })
    .from(jobs)
    .where(
      and(
        eq(jobs.entity, AUDIT_JOB_ENTITY),
        eq(jobs.entityId, auditId),
        eq(jobs.kind, auditDiagnoseJob.kind),
        eq(jobs.status, "completed"),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  const r = row?.result;
  if (!r || typeof r.proposed !== "number") return null;
  return {
    proposed: r.proposed,
    kept: typeof r.problems === "number" ? r.problems : 0,
    withoutEvidence: typeof r.withoutEvidence === "number" ? r.withoutEvidence : 0,
  };
}

export async function getDiagnosisView(db: Database, auditId: string) {
  const [problems, observations, plan, outcome] = await Promise.all([
    findingsOf(db, auditId, { kind: "problem" }),
    db
      .select()
      .from(auditFindings)
      .where(
        and(
          eq(auditFindings.auditId, auditId),
          inArray(auditFindings.kind, ["observation", "comparison"]),
          inArray(auditFindings.status, [...USABLE_FINDING_STATUSES]),
        ),
      )
      .orderBy(asc(auditFindings.area), asc(auditFindings.position)),
    db.query.auditPlans.findFirst({ where: eq(auditPlans.auditId, auditId) }),
    lastDiagnosisOutcome(db, auditId),
  ]);
  return { problems, observations, plan: plan ?? null, outcome };
}

/** Sources by id, for the "Source" chips of findings. */
export async function sourcesById(db: Database, ids: string[]): Promise<Map<string, SourceRow>> {
  if (!ids.length) return new Map();
  const rows = await db.select().from(auditSources).where(inArray(auditSources.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}
