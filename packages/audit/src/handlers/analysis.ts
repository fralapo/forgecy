import {
  AUDIT_LIMITS,
  comparisonChannels,
  type comparisonCriteria,
  confidenceFromEvidence,
  messageRefOf,
  prospectObjectiveLabels,
  socialChannels,
  USABLE_FINDING_STATUSES,
  type AuditChannel,
  type AuditEvidence,
  type ComparisonChannel,
  type FindingArea,
  type MessageRef,
  type ProspectObjective,
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
  desc,
  eq,
  inArray,
  isNull,
  ne,
  siteScans,
  sql,
  type AiMeta,
  type ComparisonData,
  type Database,
  type PageData,
  type PlanItem,
} from "@forgecy/db";
import { englishMessage, messageRef } from "@forgecy/i18n";
import { UnrecoverableError, type JobContext } from "@forgecy/jobs";
import {
  BRAND_ANALYST_CHANNELS,
  BRAND_ANALYST_COMPETITORS,
  BRAND_ANALYST_SITE,
  BRAND_ANALYST_SOCIAL,
  channelComparisonSchema,
  competitorBenchmarkSchema,
  competitorProposalSchema,
  dataBlock,
  diagnosisSchema,
  planSchema,
  quoteFound,
  siteObservationsSchema,
  socialObservationsSchema,
  STRATEGIST_COMPETITORS,
  STRATEGIST_DIAGNOSIS,
  STRATEGIST_PLAN,
} from "../ai/agents";
import { buildIndex, confidenceOf, verifyEvidence, type RefTarget } from "../ai/evidence";
import { loadAudit, type AuditRow, type ClientRow } from "../service/common";
import { channelLabel } from "../service/prospects";
import { computeChannelMetrics } from "../social/metrics";
import { domainOf, normalizeSiteUrl } from "../url";
import { needsAttention, oneLine, runAgent, unrecoverable, type AuditHandlerDeps } from "./context";
import { screenshotImages } from "./images";

type SourceRow = typeof auditSources.$inferSelect;
type FindingInsert = typeof auditFindings.$inferInsert;

// Stored as the finding title, which lands in the client report (English by default).
const criterionLabel: Record<(typeof comparisonCriteria)[number], string> = {
  color: "Dominant color",
  tone: "Tone of voice",
  cta: "Main call to action",
  audience: "Audience it speaks to",
  visual_style: "Visual style",
};

/** Text a quote from this page must be found in. */
export function pageText(source: Pick<SourceRow, "title" | "data">): string {
  const d: PageData = source.data ?? {};
  return [
    source.title,
    d.metaDescription,
    ...(d.h1 ?? []),
    ...(d.headings ?? []).map((h) => h.text),
    ...(d.ctas ?? []),
    d.textExcerpt,
  ]
    .filter(Boolean)
    .join("\n");
}

function pathOf(url: string | null): string {
  if (!url) return "/";
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function pageLabel(source: SourceRow): string {
  const path = pathOf(source.url);
  return path === "/" ? "Home" : path;
}

function pagePrompt(ref: string, source: SourceRow, maxText: number): string {
  const d: PageData = source.data ?? {};
  return dataBlock(
    `${ref} ${source.url ?? ""}`,
    [
      `Title: ${oneLine(source.title, 200)}`,
      d.metaDescription ? `Meta description: ${oneLine(d.metaDescription, 300)}` : "",
      d.h1?.length ? `H1: ${d.h1.map((h) => oneLine(h, 200)).join(" | ")}` : "H1: (none)",
      d.headings?.length
        ? `Headings: ${d.headings
            .slice(0, 15)
            .map((h) => `H${h.level} ${oneLine(h.text, 120)}`)
            .join(" | ")}`
        : "",
      d.ctas?.length
        ? `Call to action: ${d.ctas.slice(0, 12).join(" | ")}`
        : "Call to action: (none)",
      d.contactForm ? "Contact form present" : "",
      `Text: ${(d.textExcerpt ?? "").slice(0, maxText)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function pageTarget(source: SourceRow, group?: string): RefTarget {
  return {
    type: "page",
    label: pageLabel(source),
    sourceId: source.id,
    ...(source.url ? { url: source.url } : {}),
    text: pageText(source),
    channel: "website",
    capturedAt: source.capturedAt.toISOString(),
    ...(group ? { group } : {}),
  };
}

export function prospectContext(audit: AuditRow, client: ClientRow): string {
  const i = audit.inputs;
  const objectives = (i.objectives ?? [])
    .map((o) => prospectObjectiveLabels[o as ProspectObjective] ?? o)
    .concat(i.otherObjective ? [i.otherObjective] : []);
  return dataBlock(
    "prospect",
    [
      `Name: ${client.name}`,
      i.websiteUrl ? `Website: ${i.websiteUrl}` : "Website: not given",
      i.sector ? `Sector: ${i.sector}` : "",
      i.area ? `Geographic area: ${i.area}` : "",
      objectives.length ? `Objectives: ${objectives.join("; ")}` : "",
      i.notes ? `Agency notes: ${oneLine(i.notes, 1500)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function nextPosition(
  db: Pick<Database, "select">,
  auditId: string,
  kind: FindingInsert["kind"],
) {
  const [row] = await db
    .select({ next: sql<number>`coalesce(max(${auditFindings.position}), -1) + 1` })
    .from(auditFindings)
    .where(and(eq(auditFindings.auditId, auditId), eq(auditFindings.kind, kind)));
  return Number(row?.next ?? 0);
}

/**
 * Replace the agent's previous proposals that nobody touched yet; anything a
 * person reviewed or edited stays (marked as coming from an earlier reading).
 */
async function dropUntouched(
  db: Pick<Database, "delete">,
  auditId: string,
  where: { kind: FindingInsert["kind"]; channel?: AuditChannel; areas?: FindingArea[] },
) {
  await db
    .delete(auditFindings)
    .where(
      and(
        eq(auditFindings.auditId, auditId),
        eq(auditFindings.kind, where.kind),
        eq(auditFindings.status, "observed"),
        eq(auditFindings.editedByHuman, false),
        sql`${auditFindings.authorAgent} is not null`,
        where.channel ? eq(auditFindings.channel, where.channel) : undefined,
        where.areas ? inArray(auditFindings.area, where.areas) : undefined,
      ),
    );
}

async function collectedPages(db: Database, scanId: string): Promise<SourceRow[]> {
  return db
    .select()
    .from(auditSources)
    .where(
      and(
        eq(auditSources.scanId, scanId),
        eq(auditSources.kind, "page"),
        eq(auditSources.status, "collected"),
      ),
    )
    .orderBy(asc(auditSources.createdAt));
}

async function latestProspectScan(db: Database, auditId: string) {
  const [scan] = await db
    .select()
    .from(siteScans)
    .where(
      and(
        eq(siteScans.auditId, auditId),
        isNull(siteScans.competitorId),
        inArray(siteScans.status, ["collected", "partial"]),
      ),
    )
    .orderBy(desc(siteScans.createdAt))
    .limit(1);
  return scan ?? null;
}

async function setAnalysisStep(
  db: Database,
  scanId: string,
  status: "running" | "completed" | "failed",
  detail?: string,
  detailRef?: MessageRef | null,
) {
  const scan = await db.query.siteScans.findFirst({ where: eq(siteScans.id, scanId) });
  if (!scan) return;
  const at = new Date().toISOString();
  await db
    .update(siteScans)
    .set({
      steps: scan.steps.map((s) =>
        s.key === "analysis"
          ? {
              ...s,
              status,
              ...(detail ? { detail } : {}),
              ...(detailRef ? { detailRef } : {}),
              ...(status === "running" ? { startedAt: at } : { endedAt: at }),
            }
          : s,
      ),
    })
    .where(eq(siteScans.id, scanId));
}

function load(deps: AuditHandlerDeps, auditId: string) {
  return loadAudit(deps.db, auditId).then((r) => {
    if (r.audit.status === "archived" || r.audit.status === "delivered")
      throw unrecoverable("audit.jobErrors.auditClosed");
    return r;
  });
}

// ---------------------------------------------------------------- Website

export async function runAnalyzeSite(
  deps: AuditHandlerDeps,
  payload: { auditId: string; scanId: string },
  ctx: JobContext,
) {
  const { db } = deps;
  const { audit, client } = await load(deps, payload.auditId);
  const scan = await db.query.siteScans.findFirst({ where: eq(siteScans.id, payload.scanId) });
  if (!scan || scan.auditId !== audit.id) throw new UnrecoverableError("Scan not found");
  const pages = await collectedPages(db, scan.id);
  if (!pages.length) return { observations: 0 };
  await setAnalysisStep(
    db,
    scan.id,
    "running",
    englishMessage("audit.scan.analysisRunning"),
    messageRef("audit.scan.analysisRunning"),
  );
  await ctx.progress(10);

  const checks = scan.extracted?.checks ?? [];
  const index = buildIndex([
    ...pages.map((p, i): [string, RefTarget] => [`P${i + 1}`, pageTarget(p)]),
    ...checks.map((c): [string, RefTarget] => [
      `CHECK:${c.key}`,
      { type: "technical", label: c.label, text: c.detail, channel: "website" },
    ]),
  ]);
  const ex = scan.extracted ?? {};
  const prompt = [
    prospectContext(audit, client),
    ...pages.map((p, i) => pagePrompt(`P${i + 1}`, p, 2500)),
    dataBlock(
      "elements measured on the website",
      [
        ex.colors?.length
          ? `Dominant colors: ${ex.colors.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(", ")}`
          : "Colors: not measured (read without a browser)",
        ex.fonts?.length
          ? `Fonts: ${ex.fonts.map((f) => `${f.family} (${f.usage})`).join(", ")}`
          : "Fonts: not measured",
        ex.ctas?.length
          ? `Most frequent CTAs: ${ex.ctas
              .slice(0, 8)
              .map((c) => `"${c.text}" on ${c.pages.length} pages`)
              .join("; ")}`
          : "",
        `Contact form: ${ex.contactForm ? "yes" : "no"}`,
        ex.socialLinks?.length
          ? `Social links: ${ex.socialLinks.map((s) => s.channel).join(", ")}`
          : "No social links",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    dataBlock(
      "technical checks",
      checks
        .map((c) => `CHECK:${c.key} ${c.ok ? "OK" : "TO IMPROVE"} · ${c.label} · ${c.detail}`)
        .join("\n"),
    ),
    "Write the observations now. Reference pages as P1, P2... and checks as CHECK:<key>.",
  ].join("\n\n");

  let run;
  try {
    run = await runAgent(deps, ctx, {
      client,
      role: "brand_analyst",
      task: "audit_analyze",
      schema: siteObservationsSchema,
      schemaName: "site_observations",
      system: BRAND_ANALYST_SITE,
      prompt,
      action: "audit.ai.analyze_site",
      entityId: audit.id,
    });
  } catch (err) {
    await setAnalysisStep(
      db,
      scan.id,
      "failed",
      err instanceof Error ? err.message : undefined,
      messageRefOf(err),
    );
    throw err;
  }
  await ctx.progress(80);

  const rows: FindingInsert[] = [];
  for (const o of run.data.observations) {
    const v = verifyEvidence(o.evidence, index);
    if (!v.evidence.length) continue;
    const { confidence, reason } = confidenceOf(v);
    rows.push({
      auditId: audit.id,
      kind: "observation",
      area: o.area as FindingArea,
      title: o.title,
      description: o.description,
      impact: o.impact,
      recommendation: o.recommendation,
      priority: o.suggestedPriority,
      suggestedPriority: o.suggestedPriority,
      confidence,
      confidenceReason: reason,
      evidence: v.evidence,
      channel: "website",
      scanId: scan.id,
      authorAgent: "brand_analyst",
      aiMeta: run.meta,
    });
  }
  await db.transaction(async (tx) => {
    await dropUntouched(tx, audit.id, {
      kind: "observation",
      channel: "website",
    });
    const start = await nextPosition(tx, audit.id, "observation");
    if (rows.length)
      await tx.insert(auditFindings).values(rows.map((r, i) => ({ ...r, position: start + i })));
  });
  const dropped = run.data.observations.length - rows.length;
  const doneKey = dropped ? "audit.scan.analysisDoneDropped" : "audit.scan.analysisDone";
  const doneValues = { count: rows.length, dropped };
  await setAnalysisStep(
    db,
    scan.id,
    "completed",
    englishMessage(doneKey, doneValues),
    messageRef(doneKey, doneValues),
  );
  return { observations: rows.length, dropped: run.data.observations.length - rows.length };
}

// ---------------------------------------------------------------- Social

async function socialData(db: Database, auditId: string, channel: SocialChannel) {
  const [posts, metrics, files] = await Promise.all([
    db
      .select()
      .from(auditSocialPosts)
      .where(and(eq(auditSocialPosts.auditId, auditId), eq(auditSocialPosts.channel, channel)))
      .orderBy(desc(auditSocialPosts.postedOn))
      .limit(500),
    db
      .select()
      .from(auditMetrics)
      .where(and(eq(auditMetrics.auditId, auditId), eq(auditMetrics.channel, channel)))
      .orderBy(desc(auditMetrics.observedOn)),
    db
      .select({ id: auditSources.id, fileName: auditSources.fileName })
      .from(auditSources)
      .where(and(eq(auditSources.auditId, auditId), eq(auditSources.channel, channel))),
  ]);
  const fileName = new Map(files.map((f) => [f.id, f.fileName ?? "Imported file"]));
  const cards = computeChannelMetrics({
    channel,
    metrics: metrics.map((m) => ({
      metric: m.metric,
      value: m.value,
      observedOn: m.observedOn,
      source: m.source,
      sourceNote: m.sourceNote,
    })),
    posts: posts.map((p) => ({
      postedOn: p.postedOn,
      format: p.format,
      postType: p.postType,
      text: p.text,
      metrics: p.metrics,
      sourceLabel: `File: ${fileName.get(p.sourceId) ?? "imported"}`,
    })),
  });
  return { posts, metrics, cards };
}

function socialIndexEntries(
  channel: SocialChannel,
  data: Awaited<ReturnType<typeof socialData>>,
  prefix = "",
): Array<[string, RefTarget]> {
  const label = channelLabel[channel];
  return [
    ...data.posts.slice(0, 60).map((p): [string, RefTarget] => [
      `${prefix}POST:${p.rowNumber}`,
      {
        type: "file_row",
        label: `${label} · post of ${p.postedOn}`,
        sourceId: p.sourceId,
        text: p.text ?? "",
        channel,
        capturedAt: p.postedOn,
      },
    ]),
    ...data.cards
      .filter((c) => c.value !== null)
      .map((c): [string, RefTarget] => [
        `${prefix}METRIC:${c.key}`,
        {
          type: "metric",
          label: `${label} · ${c.label}: ${c.display}`,
          text: c.display,
          channel,
          ...(c.date ? { capturedAt: c.date } : {}),
        },
      ]),
  ];
}

function socialPrompt(
  channel: SocialChannel,
  data: Awaited<ReturnType<typeof socialData>>,
  prefix = "",
): string {
  return [
    dataBlock(
      `${channelLabel[channel]} · metrics`,
      data.cards
        .map(
          (c) =>
            `${prefix}METRIC:${c.key} ${c.label}: ${c.display}${
              c.value === null
                ? ` (${c.reason})`
                : ` · source: ${c.source ?? ""}${c.date ? ` · ${c.date}` : ""}`
            }`,
        )
        .join("\n"),
    ),
    dataBlock(
      `${channelLabel[channel]} · imported posts`,
      data.posts.length
        ? data.posts
            .slice(0, 60)
            .map(
              (p) =>
                `${prefix}POST:${p.rowNumber} ${p.postedOn} ${p.format ?? p.postType ?? ""} ${Object.entries(
                  p.metrics,
                )
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" ")}\n${oneLine(p.text, 300)}`,
            )
            .join("\n")
        : "No imported posts",
    ),
  ].join("\n\n");
}

export async function runAnalyzeSocial(
  deps: AuditHandlerDeps,
  payload: { auditId: string; channel: SocialChannel },
  ctx: JobContext,
) {
  const { db } = deps;
  const { audit, client } = await load(deps, payload.auditId);
  const data = await socialData(db, audit.id, payload.channel);
  const shotRows = await db
    .select({
      id: auditSources.id,
      storageKey: auditSources.storageKey,
      fileName: auditSources.fileName,
      createdAt: auditSources.createdAt,
    })
    .from(auditSources)
    .where(
      and(
        eq(auditSources.auditId, audit.id),
        eq(auditSources.channel, payload.channel),
        eq(auditSources.kind, "screenshot"),
      ),
    )
    .orderBy(desc(auditSources.createdAt));
  const shots = await screenshotImages(deps.storage, shotRows);
  if (!data.posts.length && !data.metrics.length && !shots.length)
    throw needsAttention("audit.jobErrors.noSocialData");
  const shotName = new Map(shotRows.map((s) => [s.id, s]));
  const index = buildIndex([
    ...socialIndexEntries(payload.channel, data),
    ...shots.map(({ sourceId }, i): [string, RefTarget] => [
      `IMG:${i + 1}`,
      {
        type: "screenshot",
        label: `${channelLabel[payload.channel]} · screenshot ${shotName.get(sourceId)?.fileName ?? i + 1}`,
        sourceId,
        channel: payload.channel,
        capturedAt: shotName.get(sourceId)?.createdAt.toISOString().slice(0, 10),
      },
    ]),
  ]);
  const run = await runAgent(deps, ctx, {
    client,
    role: "brand_analyst",
    task: "audit_analyze",
    schema: socialObservationsSchema,
    schemaName: "social_observations",
    system: BRAND_ANALYST_SOCIAL,
    prompt: [
      prospectContext(audit, client),
      `Channel: ${payload.channel}.`,
      socialPrompt(payload.channel, data),
      shots.length
        ? `${shots.length} screenshots are attached, in order: IMG:1 to IMG:${shots.length}.`
        : "No screenshots.",
      "Reference posts as POST:<n>, metrics as METRIC:<key> and screenshots as IMG:<n>.",
    ].join("\n\n"),
    action: "audit.ai.analyze_social",
    entityId: audit.id,
    images: shots.map((s) => s.image),
  });
  const rows: FindingInsert[] = [];
  for (const o of run.data.observations) {
    if (o.area === "linkedin_leads" && payload.channel !== "linkedin") continue;
    const v = verifyEvidence(o.evidence, index);
    if (!v.evidence.length) continue;
    const { confidence, reason } = confidenceOf(v);
    rows.push({
      auditId: audit.id,
      kind: "observation",
      area: o.area as FindingArea,
      title: o.title,
      description: o.description,
      impact: o.impact,
      recommendation: o.recommendation,
      priority: o.suggestedPriority,
      suggestedPriority: o.suggestedPriority,
      confidence,
      confidenceReason: reason,
      evidence: v.evidence,
      channel: payload.channel,
      authorAgent: "brand_analyst",
      aiMeta: run.meta,
    });
  }
  await db.transaction(async (tx) => {
    await dropUntouched(tx, audit.id, { kind: "observation", channel: payload.channel });
    const start = await nextPosition(tx, audit.id, "observation");
    if (rows.length)
      await tx.insert(auditFindings).values(rows.map((r, i) => ({ ...r, position: start + i })));
  });
  return { observations: rows.length };
}

// ---------------------------------------------------------------- Competitors

export async function runProposeCompetitors(
  deps: AuditHandlerDeps,
  payload: { auditId: string; instruction?: string | undefined },
  ctx: JobContext,
) {
  const { db } = deps;
  const { audit, client } = await load(deps, payload.auditId);
  const existing = await db
    .select()
    .from(auditCompetitors)
    .where(eq(auditCompetitors.auditId, audit.id));
  const scan = await latestProspectScan(db, audit.id);
  const home = scan ? (await collectedPages(db, scan.id))[0] : undefined;
  const run = await runAgent(deps, ctx, {
    client,
    role: "strategist",
    task: "audit_analyze",
    schema: competitorProposalSchema,
    schemaName: "competitor_proposal",
    system: STRATEGIST_COMPETITORS,
    prompt: [
      prospectContext(audit, client),
      home ? pagePrompt("prospect home page", home, 1500) : "",
      existing.length
        ? dataBlock(
            "already listed",
            existing.map((c) => `${c.name} ${c.websiteUrl ?? ""} (${c.status})`).join("\n"),
          )
        : "",
      payload.instruction ? dataBlock("instruction from the person", payload.instruction) : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    action: "audit.ai.propose_competitors",
    entityId: audit.id,
  });

  const notes = audit.inputs.notes ?? "";
  const prospectDomain = domainOf(audit.inputs.websiteUrl);
  await db.transaction(async (tx) => {
    // New proposals replace the previous ones nobody decided on yet.
    await tx
      .delete(auditCompetitors)
      .where(
        and(
          eq(auditCompetitors.auditId, audit.id),
          eq(auditCompetitors.status, "proposed"),
          sql`${auditCompetitors.proposedByAgent} is not null`,
        ),
      );
    const kept = existing.filter((c) => !(c.status === "proposed" && c.proposedByAgent));
    const domains = new Set(kept.map((c) => domainOf(c.websiteUrl)).filter(Boolean));
    const names = new Set(kept.map((c) => c.name.toLowerCase()));
    let slots = AUDIT_LIMITS.maxCompetitors - kept.filter((c) => c.status !== "removed").length;
    let position = kept.reduce((m, c) => Math.max(m, c.position + 1), 0);
    for (const c of run.data.competitors) {
      if (slots <= 0) break;
      const url = normalizeSiteUrl(c.websiteUrl);
      const domain = domainOf(url);
      if (domain && (domain === prospectDomain || domains.has(domain))) continue;
      if (names.has(c.name.toLowerCase())) continue;
      // "Mentioned in the notes" is checked on the notes, not taken from the model.
      const inNotes = notes ? quoteFound(c.name, notes) : false;
      await tx.insert(auditCompetitors).values({
        auditId: audit.id,
        name: c.name,
        websiteUrl: url,
        reason: c.reason,
        confidence: inNotes ? "medium" : "low",
        proposedByAgent: "strategist",
        status: "proposed",
        sourceStatus: url ? "pending" : "unavailable",
        sourceError: url ? null : "No website given",
        position: position++,
      });
      if (domain) domains.add(domain);
      names.add(c.name.toLowerCase());
      slots--;
    }
  });
  return { proposed: run.data.competitors.length };
}

/**
 * When the comparison cannot run (no provider, budget, policy) the audit must not stay
 * "Analysis in progress": it moves to review, where observations can be written by hand.
 */
export async function runCompareCompetitors(
  deps: AuditHandlerDeps,
  payload: { auditId: string },
  ctx: JobContext,
) {
  try {
    return await compareCompetitors(deps, payload, ctx);
  } catch (err) {
    await deps.db
      .update(audits)
      .set({ status: "in_review" })
      .where(and(eq(audits.id, payload.auditId), eq(audits.status, "analyzing")));
    throw err;
  }
}

async function compareCompetitors(
  deps: AuditHandlerDeps,
  payload: { auditId: string },
  ctx: JobContext,
) {
  const { db } = deps;
  const { audit, client } = await load(deps, payload.auditId);
  const prospectScan = await latestProspectScan(db, audit.id);
  const prospectPages = prospectScan ? (await collectedPages(db, prospectScan.id)).slice(0, 4) : [];
  const competitors = await db
    .select()
    .from(auditCompetitors)
    .where(
      and(
        eq(auditCompetitors.auditId, audit.id),
        eq(auditCompetitors.status, "confirmed"),
        inArray(auditCompetitors.sourceStatus, ["collected", "partial"]),
      ),
    )
    .orderBy(asc(auditCompetitors.position));
  const companies: Array<{
    ref: string;
    name: string;
    competitorId: string | null;
    scanId: string | null;
    pages: SourceRow[];
  }> = [];
  if (prospectScan && prospectPages.length)
    companies.push({
      ref: "PROSPECT",
      name: client.name,
      competitorId: null,
      scanId: prospectScan.id,
      pages: prospectPages,
    });
  for (const [i, c] of competitors.entries()) {
    const [scan] = await db
      .select()
      .from(siteScans)
      .where(
        and(eq(siteScans.competitorId, c.id), inArray(siteScans.status, ["collected", "partial"])),
      )
      .orderBy(desc(siteScans.createdAt))
      .limit(1);
    if (!scan) continue;
    const pages = await collectedPages(db, scan.id);
    if (pages.length)
      companies.push({
        ref: `C${i + 1}`,
        name: c.name,
        competitorId: c.id,
        scanId: scan.id,
        pages,
      });
  }
  const finish = async () => {
    if (audit.status === "analyzing")
      await db.update(audits).set({ status: "in_review" }).where(eq(audits.id, audit.id));
  };
  if (!companies.some((c) => c.competitorId)) {
    await finish();
    return { observations: 0 };
  }

  const entries: Array<[string, RefTarget]> = [];
  for (const co of companies)
    co.pages.forEach((p, i) => {
      const t = pageTarget(p, co.ref);
      entries.push([`${co.ref}:P${i + 1}`, { ...t, label: `${co.name} · ${t.label}` }]);
    });
  const index = buildIndex(entries);
  const run = await runAgent(deps, ctx, {
    client,
    role: "brand_analyst",
    task: "audit_analyze",
    schema: competitorBenchmarkSchema,
    schemaName: "competitor_benchmark",
    system: BRAND_ANALYST_COMPETITORS,
    prompt: [
      prospectContext(audit, client),
      ...companies.map((co) =>
        [
          `${co.ref} = ${co.name}${co.ref === "PROSPECT" ? " (the prospect)" : ""}`,
          ...co.pages.map((p, i) => pagePrompt(`${co.ref}:P${i + 1}`, p, 1500)),
        ].join("\n"),
      ),
      "Benchmark refs: PROSPECT, C1, C2... Evidence refs: PROSPECT:P1, C2:P1...",
    ].join("\n\n"),
    action: "audit.ai.compare_competitors",
    entityId: audit.id,
  });

  // Benchmark rows on each scan; the tone quote is kept only when found on that company's pages.
  for (const b of run.data.benchmark) {
    const co = companies.find((c) => c.ref === b.ref.trim().toUpperCase());
    if (!co?.scanId) continue;
    const text = co.pages.map(pageText).join("\n");
    const scan = await db.query.siteScans.findFirst({ where: eq(siteScans.id, co.scanId) });
    await db
      .update(siteScans)
      .set({
        extracted: {
          ...(scan?.extracted ?? {}),
          offer: b.offer,
          tone: b.tone,
          ...(b.toneQuote && quoteFound(b.toneQuote, text) ? { toneQuote: b.toneQuote } : {}),
        },
      })
      .where(eq(siteScans.id, co.scanId));
  }

  const rows: FindingInsert[] = [];
  for (const o of run.data.observations) {
    const v = verifyEvidence(o.evidence, index);
    if (!v.evidence.length) continue;
    const firstCompetitor = v.targets
      .map((t) => companies.find((c) => c.ref === t.group)?.competitorId)
      .find(Boolean);
    const { confidence, reason } = confidenceOf(v);
    rows.push({
      auditId: audit.id,
      kind: "observation",
      area: "competitors",
      title: o.title,
      description: o.description,
      impact: o.impact,
      recommendation: o.recommendation,
      priority: o.suggestedPriority,
      suggestedPriority: o.suggestedPriority,
      confidence,
      confidenceReason: reason,
      evidence: v.evidence,
      channel: "website",
      competitorId: firstCompetitor ?? null,
      authorAgent: "brand_analyst",
      aiMeta: run.meta,
    });
  }
  await db.transaction(async (tx) => {
    await dropUntouched(tx, audit.id, { kind: "observation", areas: ["competitors"] });
    const start = await nextPosition(tx, audit.id, "observation");
    if (rows.length)
      await tx.insert(auditFindings).values(rows.map((r, i) => ({ ...r, position: start + i })));
  });
  await finish();
  return { observations: rows.length };
}

// ---------------------------------------------------------------- Cross-channel

async function usableObservations(db: Database, auditId: string) {
  return db
    .select()
    .from(auditFindings)
    .where(
      and(
        eq(auditFindings.auditId, auditId),
        inArray(auditFindings.kind, ["observation", "comparison"]),
        inArray(auditFindings.status, [...USABLE_FINDING_STATUSES]),
      ),
    )
    .orderBy(asc(auditFindings.area), asc(auditFindings.position));
}

export async function runCompareChannels(
  deps: AuditHandlerDeps,
  payload: { auditId: string; instruction?: string | undefined },
  ctx: JobContext,
) {
  const { db } = deps;
  const { audit, client } = await load(deps, payload.auditId);
  const scan = await latestProspectScan(db, audit.id);
  const pages = scan ? (await collectedPages(db, scan.id)).slice(0, 5) : [];
  const social = {
    instagram: await socialData(db, audit.id, "instagram"),
    facebook: await socialData(db, audit.id, "facebook"),
  };
  const has: Record<ComparisonChannel, boolean> = {
    website: pages.length > 0,
    instagram: social.instagram.posts.length + social.instagram.metrics.length > 0,
    facebook: social.facebook.posts.length + social.facebook.metrics.length > 0,
  };
  if (comparisonChannels.filter((c) => has[c]).length < 2)
    throw needsAttention("audit.jobErrors.twoChannels");
  const observations = (await usableObservations(db, audit.id)).filter(
    (o) =>
      o.kind === "observation" &&
      o.channel &&
      comparisonChannels.includes(o.channel as ComparisonChannel),
  );
  const entries: Array<[string, RefTarget]> = [
    ...pages.map((p, i): [string, RefTarget] => [`P${i + 1}`, pageTarget(p)]),
    ...socialIndexEntries("instagram", social.instagram, "IG:"),
    ...socialIndexEntries("facebook", social.facebook, "FB:"),
    ...observations.map((o, i): [string, RefTarget] => [
      `O${i + 1}`,
      {
        type: "note",
        label: o.title.slice(0, 80),
        findingId: o.id,
        ...(o.channel ? { channel: o.channel } : {}),
      },
    ]),
  ];
  const index = buildIndex(entries);
  const ex = scan?.extracted ?? {};
  const run = await runAgent(deps, ctx, {
    client,
    role: "brand_analyst",
    task: "audit_analyze",
    schema: channelComparisonSchema,
    schemaName: "channel_comparison",
    system: BRAND_ANALYST_CHANNELS,
    prompt: [
      prospectContext(audit, client),
      `Channels with data: ${comparisonChannels.filter((c) => has[c]).join(", ")}. Channels without data must get value null.`,
      has.website
        ? [
            dataBlock(
              "website · measured elements",
              [
                ex.colors?.length
                  ? `Colors: ${ex.colors.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(", ")}`
                  : "",
                ex.ctas?.length
                  ? `CTA: ${ex.ctas
                      .slice(0, 6)
                      .map((c) => c.text)
                      .join(" | ")}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
            ),
            ...pages.map((p, i) => pagePrompt(`P${i + 1}`, p, 1200)),
          ].join("\n\n")
        : "",
      has.instagram ? socialPrompt("instagram", social.instagram, "IG:") : "",
      has.facebook ? socialPrompt("facebook", social.facebook, "FB:") : "",
      observations.length
        ? dataBlock(
            "accepted observations",
            observations
              .map((o, i) => `O${i + 1} [${o.channel}] ${o.title}: ${oneLine(o.description, 200)}`)
              .join("\n"),
          )
        : "",
      payload.instruction ? dataBlock("instruction from the person", payload.instruction) : "",
      "Evidence refs: P1 (site pages), IG:POST:<n>, IG:METRIC:<key>, FB:POST:<n>, FB:METRIC:<key>, O<n>.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    action: "audit.ai.compare_channels",
    entityId: audit.id,
  });

  const existing = await db
    .select()
    .from(auditFindings)
    .where(and(eq(auditFindings.auditId, audit.id), eq(auditFindings.kind, "comparison")));
  const keep = new Set(
    existing
      .filter((r) => r.status !== "observed" || r.editedByHuman)
      .map((r) => r.comparison?.criterion),
  );
  const rows: FindingInsert[] = [];
  for (const [position, row] of run.data.rows.entries()) {
    if (keep.has(row.criterion)) continue;
    const cells: ComparisonData["cells"] = {};
    const all: AuditEvidence[] = [];
    let distinct = 0;
    const labels: string[] = [];
    for (const channel of comparisonChannels) {
      const cell = row[channel];
      if (!has[channel]) {
        cells[channel] = {
          value: null,
          unavailableReason: "No data collected for this channel",
        };
        continue;
      }
      const v = verifyEvidence(
        cell.evidenceRefs.map((ref) => ({ ref })),
        index,
      );
      if (cell.value && !v.evidence.length) {
        cells[channel] = {
          value: null,
          unavailableReason: "Value without verifiable evidence: rejected",
        };
        continue;
      }
      cells[channel] = {
        value: cell.value,
        ...(cell.value
          ? {}
          : { unavailableReason: cell.unavailableReason ?? "Not visible in the data" }),
        evidence: v.evidence,
      };
      all.push(...v.evidence);
      distinct += v.evidence.length ? 1 : 0;
      labels.push(...v.labels);
    }
    const comparison: ComparisonData = {
      criterion: row.criterion,
      cells,
      outcome: row.outcome,
      proposedOutcome: row.outcome,
      rationale: row.rationale,
    };
    const confidence = confidenceFromEvidence(distinct);
    rows.push({
      auditId: audit.id,
      kind: "comparison",
      area: "cross_channel",
      title: criterionLabel[row.criterion],
      description: row.rationale,
      priority: row.outcome === "to_align" ? "high" : "medium",
      suggestedPriority: row.outcome === "to_align" ? "high" : "medium",
      confidence,
      confidenceReason: distinct
        ? `Values verified on ${distinct} channels: ${[...new Set(labels)].slice(0, 3).join(", ")}`
        : "No verified values",
      evidence: all.slice(0, 8),
      comparison,
      authorAgent: "brand_analyst",
      aiMeta: run.meta,
      position,
    });
  }
  await db.transaction(async (tx) => {
    await dropUntouched(tx, audit.id, { kind: "comparison" });
    if (rows.length) await tx.insert(auditFindings).values(rows);
  });
  return { rows: rows.length, kept: keep.size };
}

// ---------------------------------------------------------------- Diagnosis

export async function runDiagnose(
  deps: AuditHandlerDeps,
  payload: { auditId: string },
  ctx: JobContext,
) {
  const { db } = deps;
  const { audit, client } = await load(deps, payload.auditId);
  const observations = await usableObservations(db, audit.id);
  if (!observations.length) throw needsAttention("audit.jobErrors.noAcceptedObservations");
  const index = buildIndex(
    observations.map((o, i): [string, RefTarget] => [
      `O${i + 1}`,
      { type: "note", label: o.title.slice(0, 80), findingId: o.id },
    ]),
  );
  const run = await runAgent(deps, ctx, {
    client,
    role: "strategist",
    task: "audit_diagnose",
    schema: diagnosisSchema,
    schemaName: "diagnosis",
    system: STRATEGIST_DIAGNOSIS,
    prompt: [
      prospectContext(audit, client),
      dataBlock(
        "accepted observations",
        observations
          .map(
            (o, i) =>
              `O${i + 1} [${o.area}${o.channel ? ` · ${o.channel}` : ""} · priority ${o.priority} · confidence ${o.confidence}] ${o.title}\n${oneLine(o.description, 400)}${
                o.comparison
                  ? `\nComparison outcome: ${o.comparison.outcome}${o.comparison.outcomeNote ? ` (${o.comparison.outcomeNote})` : ""}`
                  : ""
              }`,
          )
          .join("\n"),
      ),
    ].join("\n\n"),
    action: "audit.ai.diagnose",
    entityId: audit.id,
  });

  const existing = await db
    .select()
    .from(auditFindings)
    .where(and(eq(auditFindings.auditId, audit.id), eq(auditFindings.kind, "problem")));
  const keptUsable = existing.filter(
    (p) =>
      USABLE_FINDING_STATUSES.includes(p.status) || (p.status === "observed" && p.editedByHuman),
  ).length;
  let slots = AUDIT_LIMITS.maxProblems - keptUsable;
  const rows: FindingInsert[] = [];
  let withoutEvidence = 0;
  for (const p of run.data.problems) {
    if (slots <= 0) break;
    const v = verifyEvidence(
      p.observationRefs.map((ref) => ({ ref })),
      index,
    );
    if (!v.findingIds.length) {
      withoutEvidence++;
      continue;
    }
    const parents = observations.filter((o) => v.findingIds.includes(o.id));
    const evidence = parents.flatMap((o) => o.evidence).slice(0, 8);
    const confidence = confidenceFromEvidence(parents.length);
    rows.push({
      auditId: audit.id,
      kind: "problem",
      area: "cross_channel",
      title: p.title,
      description: p.description,
      impact: p.impact,
      recommendation: p.recommendation,
      priority: p.suggestedPriority,
      suggestedPriority: p.suggestedPriority,
      confidence,
      confidenceReason: `Based on ${parents.length} ${parents.length === 1 ? "accepted observation" : "accepted observations"}`,
      evidence,
      parentIds: parents.map((o) => o.id),
      authorAgent: "strategist",
      aiMeta: run.meta,
    });
    slots--;
  }
  await db.transaction(async (tx) => {
    await dropUntouched(tx, audit.id, { kind: "problem" });
    const start = await nextPosition(tx, audit.id, "problem");
    if (rows.length)
      await tx.insert(auditFindings).values(rows.map((r, i) => ({ ...r, position: start + i })));
    await tx.update(audits).set({ diagnosisAt: new Date() }).where(eq(audits.id, audit.id));
  });
  // Stored as the job result: the diagnosis page explains why fewer problems arrived.
  return { problems: rows.length, proposed: run.data.problems.length, withoutEvidence };
}

// ---------------------------------------------------------------- Plan

export async function runPlan(
  deps: AuditHandlerDeps,
  payload: { auditId: string },
  ctx: JobContext,
) {
  const { db } = deps;
  const { audit, client } = await load(deps, payload.auditId);
  const problems = await db
    .select()
    .from(auditFindings)
    .where(
      and(
        eq(auditFindings.auditId, audit.id),
        eq(auditFindings.kind, "problem"),
        inArray(auditFindings.status, [...USABLE_FINDING_STATUSES]),
      ),
    )
    .orderBy(asc(auditFindings.position));
  if (!problems.length) throw needsAttention("audit.jobErrors.acceptProblem");
  const states = await db
    .select()
    .from(auditChannelStates)
    .where(
      and(
        eq(auditChannelStates.auditId, audit.id),
        ne(auditChannelStates.status, "unavailable"),
        ne(auditChannelStates.status, "skipped"),
      ),
    );
  const channels = states
    .map((s) => s.channel)
    .filter((c): c is SocialChannel => (socialChannels as readonly string[]).includes(c));
  if (!channels.length) throw needsAttention("audit.jobErrors.noSocialChannel");
  const run = await runAgent(deps, ctx, {
    client,
    role: "strategist",
    task: "audit_plan",
    schema: planSchema,
    schemaName: "content_plan",
    system: STRATEGIST_PLAN,
    prompt: [
      prospectContext(audit, client),
      `Channels the prospect has: ${channels.join(", ")}.`,
      dataBlock(
        "diagnosis",
        problems
          .map(
            (p, i) =>
              `D${i + 1} [priority ${p.priority}] ${p.title}: ${oneLine(p.recommendation, 300)}`,
          )
          .join("\n"),
      ),
    ].join("\n\n"),
    action: "audit.ai.plan",
    entityId: audit.id,
  });
  const pillarNames = new Set(run.data.pillars.map((p) => p.name));
  const pillars = run.data.pillars.map((p) => ({
    name: p.name,
    goal: p.goal,
    problemIds: p.problemRefs
      .map((r) => problems[Number(r.replace(/\D/g, "")) - 1]?.id)
      .filter((id): id is string => Boolean(id)),
  }));
  const items: PlanItem[] = run.data.items
    .filter((i) => channels.includes(i.channel) && pillarNames.has(i.pillar))
    .sort((a, b) => a.day - b.day);
  const meta: AiMeta = run.meta;
  await db
    .insert(auditPlans)
    .values({
      auditId: audit.id,
      pillars,
      items,
      status: "observed",
      authorAgent: "strategist",
      aiMeta: meta,
    })
    .onConflictDoUpdate({
      target: auditPlans.auditId,
      set: {
        pillars,
        items,
        status: "observed",
        authorAgent: "strategist",
        aiMeta: meta,
        updatedAt: new Date(),
      },
    });
  return { pillars: pillars.length, items: items.length };
}
