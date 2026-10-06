/** Read models of the content pages. Every query checks `view` on the client. */
import { getPublishedBrandIdentity } from "@forgecy/brand";
import { assertCan, type Actor } from "@forgecy/core";
import {
  and,
  assets,
  contentApprovals,
  contentComments,
  contentExports,
  contentOutlines,
  contentPillars,
  contentPlanItems,
  contentPlans,
  contentRubrics,
  contentSlideEdits,
  contentVersions,
  contents,
  desc,
  eq,
  inArray,
  isNull,
  jobs,
  ne,
  or,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { checkDocument, getContentRow, isLocked, outlineOf } from "./carousels/carousels";
import { parseDocument, perWeek } from "./document";
import { productSource, hasProductCatalog } from "./products";
import { getTemplate, listUsableTemplates } from "./carousels/templates";

const freqOf = (count: number | null, unit: "week" | "month" | null) =>
  count && unit ? { count, unit } : null;

/** Strategy page: pillars, rubrics, plan in use, open Planner proposals, frequency warnings. */
export async function getStrategyOverview(db: Database, actor: Actor, clientId: string) {
  assertCan(actor, "view", clientId);
  const [brand, pillars, rubrics, plans, usage, products] = await Promise.all([
    getPublishedBrandIdentity(db, actor, clientId),
    db
      .select()
      .from(contentPillars)
      .where(and(eq(contentPillars.clientId, clientId), ne(contentPillars.status, "rejected")))
      .orderBy(contentPillars.createdAt),
    db
      .select()
      .from(contentRubrics)
      .where(and(eq(contentRubrics.clientId, clientId), ne(contentRubrics.status, "rejected")))
      .orderBy(contentRubrics.createdAt),
    db
      .select()
      .from(contentPlans)
      .where(
        and(
          eq(contentPlans.clientId, clientId),
          inArray(contentPlans.status, ["active", "proposed"]),
        ),
      ),
    db
      .select({ pillarId: contents.pillarId, n: sql<number>`count(*)::int` })
      .from(contents)
      .where(and(eq(contents.clientId, clientId), ne(contents.status, "archived")))
      .groupBy(contents.pillarId),
    productSource().listApproved(db, clientId),
  ]);
  const planIds = plans.map((p) => p.id);
  const items = planIds.length
    ? await db
        .select()
        .from(contentPlanItems)
        .where(
          and(
            inArray(contentPlanItems.planId, planIds),
            inArray(contentPlanItems.status, ["accepted", "proposed", "stale"]),
          ),
        )
        .orderBy(contentPlanItems.day)
    : [];
  const contentsByPillar = new Map(usage.map((u) => [u.pillarId, u.n]));
  const live = (s: string) => s === "accepted" || s === "stale";
  const warnings: { pillarId: string; message: string }[] = [];
  for (const p of pillars.filter((x) => live(x.status))) {
    const own = rubrics.filter((r) => r.pillarId === p.id && live(r.status));
    const sum = own.reduce((t, r) => t + perWeek(freqOf(r.frequencyCount, r.frequencyUnit)), 0);
    const cap = perWeek(freqOf(p.frequencyCount, p.frequencyUnit));
    if (cap > 0 && sum > cap + 1e-9)
      warnings.push({
        pillarId: p.id,
        message: `The rubrics of “${p.name}” ask for more content than the pillar (${sum.toFixed(1)} vs ${cap.toFixed(1)} per week)`,
      });
  }
  const active = plans.find((p) => p.status === "active") ?? null;
  const proposed = plans.find((p) => p.status === "proposed") ?? null;
  return {
    brand: brand
      ? {
          versionId: brand.versionId,
          number: brand.number,
          audience: brand.document.strategy.audience
            .filter((a) => !a.deprecated)
            .map((a) => ({ id: a.id, name: a.value.name })),
          brandPillars: brand.document.content.pillars
            .filter((p) => !p.deprecated)
            .map((p) => ({ key: p.value.key, name: p.value.name, goal: p.value.goal })),
        }
      : null,
    pillars: pillars.map((p) => ({ ...p, contents: contentsByPillar.get(p.id) ?? 0 })),
    rubrics,
    activePlan: active ? { ...active, items: items.filter((i) => i.planId === active.id) } : null,
    proposedPlan: proposed
      ? { ...proposed, items: items.filter((i) => i.planId === proposed.id) }
      : null,
    products,
    hasCatalog: hasProductCatalog(),
    warnings,
  };
}

export type StrategyOverview = Awaited<ReturnType<typeof getStrategyOverview>>;

/** Carousels of a client, newest first, with their pillar name. */
export async function listCarousels(
  db: Database,
  actor: Actor,
  clientId: string,
  filter: { status?: (typeof contents.$inferSelect)["status"][]; includeArchived?: boolean } = {},
) {
  assertCan(actor, "view", clientId);
  return db
    .select({
      id: contents.id,
      title: contents.title,
      status: contents.status,
      channel: contents.channel,
      format: contents.format,
      slideCount: contents.slideCount,
      pillarName: contentPillars.name,
      updatedAt: contents.updatedAt,
      lockedByJobId: contents.lockedByJobId,
      lockExpiresAt: contents.lockExpiresAt,
    })
    .from(contents)
    .leftJoin(contentPillars, eq(contentPillars.id, contents.pillarId))
    .where(
      and(
        eq(contents.clientId, clientId),
        filter.status?.length ? inArray(contents.status, filter.status) : undefined,
        filter.includeArchived ? undefined : ne(contents.status, "archived"),
      ),
    )
    .orderBy(desc(contents.updatedAt))
    .limit(300);
}

/** Recent jobs of a carousel, for progress and “needs attention” messages. */
export async function listContentJobs(db: Database, contentId: string) {
  return db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      progress: jobs.progress,
      error: jobs.error,
      result: jobs.result,
      createdAt: jobs.createdAt,
      endedAt: jobs.endedAt,
    })
    .from(jobs)
    .where(and(eq(jobs.entity, "content"), eq(jobs.entityId, contentId)))
    .orderBy(desc(jobs.createdAt))
    .limit(20);
}

/** Everything the carousel pages need, in one read. */
export async function getCarouselWorkspace(
  db: Database,
  actor: Actor,
  clientId: string,
  id: string,
) {
  assertCan(actor, "view", clientId);
  const c = await getContentRow(db, clientId, id);
  const doc = parseDocument(c.draft);
  const [
    template,
    pillar,
    rubric,
    product,
    outlines,
    versions,
    comments,
    approvals,
    exports,
    edits,
    library,
    recentJobs,
    brand,
  ] = await Promise.all([
    getTemplate(db, clientId, c.templateKey, c.templateVersion).catch(() => null),
    c.pillarId
      ? db
          .select()
          .from(contentPillars)
          .where(eq(contentPillars.id, c.pillarId))
          .then((r) => r[0] ?? null)
      : null,
    c.rubricId
      ? db
          .select()
          .from(contentRubrics)
          .where(eq(contentRubrics.id, c.rubricId))
          .then((r) => r[0] ?? null)
      : null,
    c.productId ? productSource().get(db, clientId, c.productId) : null,
    db
      .select({
        number: contentOutlines.number,
        origin: contentOutlines.origin,
        instruction: contentOutlines.instruction,
        createdAt: contentOutlines.createdAt,
      })
      .from(contentOutlines)
      .where(eq(contentOutlines.contentId, c.id))
      .orderBy(desc(contentOutlines.number))
      .limit(50),
    db
      .select({
        id: contentVersions.id,
        number: contentVersions.number,
        createdFrom: contentVersions.createdFrom,
        createdAt: contentVersions.createdAt,
        meta: contentVersions.meta,
        authorName: users.name,
      })
      .from(contentVersions)
      .leftJoin(users, eq(users.id, contentVersions.createdBy))
      .where(eq(contentVersions.contentId, c.id))
      .orderBy(desc(contentVersions.number))
      .limit(100),
    db
      .select({
        id: contentComments.id,
        body: contentComments.body,
        slideId: contentComments.slideId,
        createdAt: contentComments.createdAt,
        resolvedAt: contentComments.resolvedAt,
        authorName: users.name,
      })
      .from(contentComments)
      .leftJoin(users, eq(users.id, contentComments.authorId))
      .where(eq(contentComments.contentId, c.id))
      .orderBy(desc(contentComments.createdAt))
      .limit(200),
    db
      .select({
        id: contentApprovals.id,
        decision: contentApprovals.decision,
        note: contentApprovals.note,
        selfApproval: contentApprovals.selfApproval,
        decidedAt: contentApprovals.decidedAt,
        versionId: contentApprovals.versionId,
        deciderName: users.name,
      })
      .from(contentApprovals)
      .leftJoin(users, eq(users.id, contentApprovals.decidedBy))
      .where(eq(contentApprovals.contentId, c.id))
      .orderBy(desc(contentApprovals.decidedAt))
      .limit(50),
    db
      .select()
      .from(contentExports)
      .where(eq(contentExports.contentId, c.id))
      .orderBy(desc(contentExports.createdAt))
      .limit(30),
    db
      .select()
      .from(contentSlideEdits)
      .where(eq(contentSlideEdits.contentId, c.id))
      .orderBy(desc(contentSlideEdits.createdAt))
      .limit(50),
    db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.clientId, clientId),
          ne(assets.status, "rejected"),
          or(eq(assets.contentId, c.id), isNull(assets.contentId), eq(assets.source, "upload")),
        ),
      )
      .orderBy(desc(assets.createdAt))
      .limit(200),
    listContentJobs(db, c.id),
    getPublishedBrandIdentity(db, actor, clientId),
  ]);
  const checks = doc.slides.length ? await checkDocument(db, actor, c, doc) : null;
  return {
    content: c,
    document: doc,
    outline: outlineOf(c),
    outlineStale: c.outlineBriefRev !== null && c.outlineBriefRev !== c.briefRev,
    template,
    pillar,
    rubric,
    product,
    outlines,
    versions,
    comments,
    approvals,
    exports,
    edits,
    library,
    jobs: recentJobs,
    locked: isLocked(c),
    checks,
    audience: (brand?.document.strategy.audience ?? [])
      .filter((a) => !a.deprecated)
      .map((a) => ({ id: a.id, name: a.value.name })),
    brandPublished: Boolean(brand),
  };
}

export type CarouselWorkspace = Awaited<ReturnType<typeof getCarouselWorkspace>>;

/** Data for the “New carousel” form. */
export async function getNewCarouselOptions(db: Database, actor: Actor, clientId: string) {
  assertCan(actor, "view", clientId);
  const [brand, templates, pillars, rubrics, products] = await Promise.all([
    getPublishedBrandIdentity(db, actor, clientId),
    listUsableTemplates(db, clientId),
    db
      .select({ id: contentPillars.id, name: contentPillars.name })
      .from(contentPillars)
      .where(and(eq(contentPillars.clientId, clientId), eq(contentPillars.status, "accepted"))),
    db
      .select({
        id: contentRubrics.id,
        name: contentRubrics.name,
        pillarId: contentRubrics.pillarId,
        templateKey: contentRubrics.templateKey,
      })
      .from(contentRubrics)
      .where(and(eq(contentRubrics.clientId, clientId), eq(contentRubrics.status, "accepted"))),
    productSource().listApproved(db, clientId),
  ]);
  return {
    brandPublished: Boolean(brand),
    audience: (brand?.document.strategy.audience ?? [])
      .filter((a) => !a.deprecated)
      .map((a) => ({ id: a.id, name: a.value.name })),
    templates: templates.map((t) => ({
      key: t.key,
      version: t.version,
      name: t.name,
      description: t.description,
      format: t.format,
      channel: t.channel,
      slides: t.manifest.slides,
    })),
    pillars,
    rubrics,
    products: products.map((p) => ({ id: p.id, name: p.name, price: p.price })),
  };
}

/** Plan item details to prefill a new carousel. */
export async function getPlanItem(db: Database, actor: Actor, clientId: string, id: string) {
  assertCan(actor, "view", clientId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select()
    .from(contentPlanItems)
    .where(and(eq(contentPlanItems.id, id), eq(contentPlanItems.clientId, clientId)));
  return row ?? null;
}
