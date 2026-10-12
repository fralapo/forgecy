/**
 * Batch automations (spec pages 58–59): configure, start, pause, resume, cancel and
 * retry. Every person may manage every automation; agents never start one (server
 * check). The items run one at a time in the worker, as the person who started the
 * run, and every carousel they create stays a draft.
 */
import { createDbLedger, monthKey, type BudgetScope } from "@forgecy/ai";
import { getPublishedBrandIdentity } from "@forgecy/brand";
import { humanOnly } from "@forgecy/content";
import {
  AUTOMATION_MAX_ITEMS,
  type Actor,
  type AiPolicy,
  type AutomationSource,
  type AutomationStopPoint,
} from "@forgecy/core";
import {
  and,
  automationRunItems,
  automationRuns,
  automations,
  brandIdentityVersions,
  clients,
  clientScopeWhere,
  contentPlanItems,
  contentPlans,
  desc,
  eq,
  inArray,
  isNull,
  jobsLog,
  ne,
  notify,
  or,
  sql,
  type Database,
} from "@forgecy/db";
import { localizedError, type MessageKey, type MessageValues } from "@forgecy/i18n";
import { enqueueJob, type JobQueues } from "@forgecy/jobs";
import {
  automationConfigSchema,
  automationItemsSchema,
  automationParamsSchema,
  configBlockers,
  readItems,
  readParams,
  type AutomationItem,
  type AutomationItemInput,
  type AutomationParams,
} from "./config";
import { automationItemJob } from "./jobs";

export type AutomationRow = typeof automations.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;
export type AutomationRunItemRow = typeof automationRunItems.$inferSelect;

type ErrorKey = Extract<MessageKey, `automations.errors.${string}`>;
const fail = (
  code: "validation" | "conflict" | "not_found" | "budget_exceeded" | "policy_blocked",
  key: ErrorKey,
  values?: MessageValues,
  details?: Record<string, unknown>,
): never => {
  throw localizedError(code, key, values, details);
};

/** Cost of one carousel when there is no history yet, in micro-dollars (outline, slides). */
export const FALLBACK_COST_MICRO_USD = { outline: 20_000, slides: 60_000 } as const;
/** “Confirm the estimated cost” is required above this share of the remaining budget. */
export const CONFIRM_BUDGET_PERCENT = 90;

// ---- Reading ----

async function requireAutomation(db: Database, id: string): Promise<AutomationRow> {
  const [row] = await db.select().from(automations).where(eq(automations.id, id));
  if (!row) fail("not_found", "automations.errors.notFound");
  return row!;
}

/** The automation, checking the person may see its client. */
export async function getAutomation(db: Database, actor: Actor, id: string) {
  humanOnly(actor, "view");
  const row = await requireAutomation(db, id);
  humanOnly(actor, "view", row.clientId);
  return { ...row, params: readParams(row.params), items: readItems(row.items) };
}

export type AutomationView = Awaited<ReturnType<typeof getAutomation>>;

export interface RunCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  costMicroUsd: number;
}

async function countsFor(db: Database, runIds: string[]): Promise<Map<string, RunCounts>> {
  const out = new Map<string, RunCounts>();
  if (!runIds.length) return out;
  const rows = await db
    .select({
      runId: automationRunItems.runId,
      status: automationRunItems.status,
      n: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${automationRunItems.costMicroUsd}), 0)::bigint`,
    })
    .from(automationRunItems)
    .where(inArray(automationRunItems.runId, runIds))
    .groupBy(automationRunItems.runId, automationRunItems.status);
  for (const r of rows) {
    const c = out.get(r.runId) ?? {
      total: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      costMicroUsd: 0,
    };
    c.total += r.n;
    c[r.status] += r.n;
    c.costMicroUsd += Number(r.cost);
    out.set(r.runId, c);
  }
  return out;
}

/** Page 58: every automation the person can see, newest activity first, with its last run. */
export async function listAutomations(
  db: Database,
  actor: Actor,
  filter: { clientId?: string; status?: AutomationRow["status"]; source?: AutomationSource } = {},
) {
  humanOnly(actor, "view");
  const rows = await db
    .select({ a: automations, clientName: clients.name, clientSlug: clients.slug })
    .from(automations)
    .innerJoin(clients, eq(clients.id, automations.clientId))
    .where(
      and(
        clientScopeWhere(actor, automations.clientId),
        filter.clientId ? eq(automations.clientId, filter.clientId) : undefined,
        filter.status ? eq(automations.status, filter.status) : undefined,
        filter.source ? eq(automations.source, filter.source) : undefined,
      ),
    )
    .orderBy(desc(automations.updatedAt))
    .limit(200);
  const visible = rows.filter((r) => {
    try {
      humanOnly(actor, "view", r.a.clientId);
      return true;
    } catch {
      return false;
    }
  });
  const ids = visible.map((r) => r.a.id);
  const lastRuns = ids.length
    ? await db
        .selectDistinctOn([automationRuns.automationId])
        .from(automationRuns)
        .where(inArray(automationRuns.automationId, ids))
        .orderBy(automationRuns.automationId, desc(automationRuns.number))
    : [];
  const counts = await countsFor(
    db,
    lastRuns.map((r) => r.id),
  );
  const byAutomation = new Map(lastRuns.map((r) => [r.automationId, r]));
  return visible.map(({ a, clientName, clientSlug }) => {
    const lastRun = byAutomation.get(a.id) ?? null;
    return {
      ...a,
      itemCount: readItems(a.items).length,
      clientName,
      clientSlug,
      lastRun: lastRun ? { ...lastRun, counts: counts.get(lastRun.id) ?? null } : null,
    };
  });
}

/** Runs of an automation, newest first, with their counts. */
export async function listRuns(db: Database, actor: Actor, automationId: string) {
  const a = await getAutomation(db, actor, automationId);
  const runs = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, a.id))
    .orderBy(desc(automationRuns.number));
  const counts = await countsFor(
    db,
    runs.map((r) => r.id),
  );
  return runs.map((r) => ({ ...r, counts: counts.get(r.id) ?? null }));
}

export async function listRunItems(db: Database, actor: Actor, runId: string) {
  humanOnly(actor, "view");
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
  if (!run) fail("not_found", "automations.errors.runNotFound");
  humanOnly(actor, "view", run!.clientId);
  return db
    .select()
    .from(automationRunItems)
    .where(eq(automationRunItems.runId, runId))
    .orderBy(automationRunItems.position);
}

/** The automation and run item that created a carousel, for the link in its header. */
export async function automationOfContent(db: Database, actor: Actor, contentId: string) {
  humanOnly(actor, "view");
  const [row] = await db
    .select({ id: automations.id, name: automations.name, clientId: automations.clientId })
    .from(automationRunItems)
    .innerJoin(automations, eq(automations.id, automationRunItems.automationId))
    .where(eq(automationRunItems.contentId, contentId))
    .limit(1);
  if (!row) return null;
  humanOnly(actor, "view", row.clientId);
  return { id: row.id, name: row.name };
}

// ---- Clients and plan items ----

/** Active clients with a published Brand Identity and a policy other than no AI (page 58). */
export async function eligibleClients(db: Database, actor: Actor) {
  humanOnly(actor, "view");
  const rows = await db
    .selectDistinct({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      aiPolicy: clients.aiPolicy,
    })
    .from(clients)
    .innerJoin(
      brandIdentityVersions,
      and(
        eq(brandIdentityVersions.clientId, clients.id),
        eq(brandIdentityVersions.status, "published"),
      ),
    )
    .where(
      and(eq(clients.status, "active"), isNull(clients.archivedAt), ne(clients.aiPolicy, "no_ai")),
    )
    .orderBy(clients.name);
  return rows.filter((r) => {
    try {
      humanOnly(actor, "edit_draft", r.id);
      return true;
    } catch {
      return false;
    }
  });
}

/** Accepted items of the client's active plan, with the carousel already linked if any. */
export async function planItemsFor(db: Database, actor: Actor, clientId: string) {
  humanOnly(actor, "view", clientId);
  return db
    .select({
      id: contentPlanItems.id,
      day: contentPlanItems.day,
      channel: contentPlanItems.channel,
      format: contentPlanItems.format,
      pillarId: contentPlanItems.pillarId,
      rubricId: contentPlanItems.rubricId,
      theme: contentPlanItems.theme,
      hook: contentPlanItems.hook,
      notes: contentPlanItems.notes,
      contentId: contentPlanItems.contentId,
    })
    .from(contentPlanItems)
    .innerJoin(contentPlans, eq(contentPlans.id, contentPlanItems.planId))
    .where(
      and(
        eq(contentPlanItems.clientId, clientId),
        eq(contentPlanItems.status, "accepted"),
        eq(contentPlans.status, "active"),
      ),
    )
    .orderBy(contentPlanItems.day);
}

type PlanItem = Awaited<ReturnType<typeof planItemsFor>>[number];

/** A configuration item seeded from a plan item: theme, hook and notes become the brief. */
export function itemFromPlan(p: PlanItem): AutomationItemInput {
  return {
    id: crypto.randomUUID().slice(0, 12),
    title: p.theme,
    brief: [p.theme, p.hook, p.notes].filter(Boolean).join("\n"),
    pillarId: p.pillarId,
    rubricId: p.rubricId,
    planItemId: p.id,
    channel: (p.channel as AutomationItem["channel"]) ?? null,
    format: (p.format as AutomationItem["format"]) ?? null,
  };
}

// ---- Configuration ----

function assertEditable(row: AutomationRow) {
  if (row.status === "failed") fail("conflict", "automations.errors.failedFinal");
  if (row.status === "active") fail("conflict", "automations.errors.runningReadOnly");
}

export async function createAutomation(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    name: string;
    source: AutomationSource;
    planItemIds?: readonly string[];
    params?: Partial<AutomationParams>;
  },
): Promise<AutomationRow> {
  humanOnly(actor, "edit_draft", input.clientId);
  const eligible = await eligibleClients(db, actor);
  if (!eligible.some((c) => c.id === input.clientId))
    fail("validation", "automations.errors.clientNotEligible");
  let items: AutomationItem[] = [];
  if (input.source === "plan" && input.planItemIds?.length) {
    const wanted = new Set(input.planItemIds);
    const plan = await planItemsFor(db, actor, input.clientId);
    items = automationItemsSchema.parse(
      plan
        .filter((p) => wanted.has(p.id) && !p.contentId)
        .slice(0, AUTOMATION_MAX_ITEMS)
        .map(itemFromPlan),
    );
  }
  const config = automationConfigSchema.parse({
    name: input.name,
    stopAt: "outline",
    params: input.params ?? {},
    items,
  });
  const [row] = await db
    .insert(automations)
    .values({
      clientId: input.clientId,
      name: config.name,
      source: input.source,
      stopAt: config.stopAt,
      params: config.params,
      items: config.items,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();
  return row!;
}

/** Saves the configuration; `rev` must match (`CONFLICT-DRAFT-REV`). Read-only while running. */
export async function updateAutomation(
  db: Database,
  actor: Actor,
  input: {
    id: string;
    rev: number;
    name?: string;
    stopAt?: AutomationStopPoint;
    params?: unknown;
    items?: unknown;
  },
): Promise<AutomationRow> {
  const row = await requireAutomation(db, input.id);
  humanOnly(actor, "edit_draft", row.clientId);
  assertEditable(row);
  const config = automationConfigSchema.parse({
    name: input.name ?? row.name,
    stopAt: input.stopAt ?? row.stopAt,
    params: input.params === undefined ? readParams(row.params) : input.params,
    items: input.items === undefined ? readItems(row.items) : input.items,
  });
  if (row.source === "briefs" && config.items.some((i) => i.planItemId))
    fail("validation", "automations.errors.planItemInBriefs");
  const [updated] = await db
    .update(automations)
    .set({
      name: config.name,
      stopAt: config.stopAt,
      params: automationParamsSchema.parse(config.params),
      items: config.items,
      draftRev: sql`${automations.draftRev} + 1`,
      updatedBy: actor.id,
      updatedAt: new Date(),
    })
    .where(and(eq(automations.id, row.id), eq(automations.draftRev, input.rev)))
    .returning();
  if (!updated)
    fail("conflict", "automations.errors.revConflict", undefined, {
      code: "CONFLICT-DRAFT-REV",
      rev: row.draftRev,
    });
  return updated!;
}

async function runCount(db: Database, automationId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId));
  return r?.n ?? 0;
}

/** Only a draft that never ran (UXA-P5-06): the carousels of a run point to it. */
export async function deleteAutomation(db: Database, actor: Actor, id: string) {
  const row = await requireAutomation(db, id);
  humanOnly(actor, "edit_draft", row.clientId);
  if (row.status !== "draft" || (await runCount(db, row.id)) > 0)
    fail("conflict", "automations.errors.deleteRan");
  await db.delete(automations).where(eq(automations.id, row.id));
}

/** A new draft with the same settings and items, without runs. */
export async function duplicateAutomation(
  db: Database,
  actor: Actor,
  input: { id: string; name: string },
): Promise<AutomationRow> {
  const row = await requireAutomation(db, input.id);
  humanOnly(actor, "edit_draft", row.clientId);
  const [copy] = await db
    .insert(automations)
    .values({
      clientId: row.clientId,
      name: input.name.trim().slice(0, 120) || row.name,
      source: row.source,
      stopAt: row.stopAt,
      params: readParams(row.params),
      // Plan items keep their link: a plan item that already has a carousel fails on its own.
      items: readItems(row.items).map((i) => ({ ...i, id: crypto.randomUUID().slice(0, 12) })),
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();
  return copy!;
}

// ---- Estimate and budget ----

/** Average cost of an outline and of slides over the last 90 days, else the fallback. */
export async function costPerItem(db: Database): Promise<{ outline: number; slides: number }> {
  const rows = await db
    .select({
      kind: jobsLog.kind,
      avg: sql<number>`coalesce(avg(${jobsLog.costMicroUsd}), 0)::bigint`,
      n: sql<number>`count(*)::int`,
    })
    .from(jobsLog)
    .where(
      and(
        inArray(jobsLog.kind, ["outline", "slides"]),
        eq(jobsLog.status, "ok"),
        sql`${jobsLog.startedAt} > now() - interval '90 days'`,
      ),
    )
    .groupBy(jobsLog.kind);
  const avg = (kind: "outline" | "slides") => {
    const r = rows.find((x) => x.kind === kind);
    return r && r.n >= 3 && Number(r.avg) > 0 ? Number(r.avg) : FALLBACK_COST_MICRO_USD[kind];
  };
  return { outline: avg("outline"), slides: avg("slides") };
}

export interface BudgetLeft {
  scope: "client" | "agency";
  limitMicroUsd: number;
  spentMicroUsd: number;
  leftMicroUsd: number;
}

/** Remaining monthly budget of the client and of the agency (only scopes with a limit). */
export async function budgetsLeft(db: Database, clientId: string): Promise<BudgetLeft[]> {
  const ledger = createDbLedger(db);
  const month = monthKey();
  const scopes: Array<[BudgetLeft["scope"], BudgetScope]> = [
    ["client", { scope: "client", clientId }],
    ["agency", { scope: "agency" }],
  ];
  const out: BudgetLeft[] = [];
  for (const [name, scope] of scopes) {
    const [limit, spent] = await Promise.all([
      ledger.budgetFor(scope, month),
      ledger.monthSpendMicroUsd(scope, month),
    ]);
    if (!limit) continue;
    out.push({
      scope: name,
      limitMicroUsd: limit.limitMicroUsd,
      spentMicroUsd: spent,
      leftMicroUsd: Math.max(0, limit.limitMicroUsd - spent),
    });
  }
  return out;
}

export interface StartEstimate {
  items: number;
  perItemMicroUsd: number;
  totalMicroUsd: number;
  /** Range shown to the person: ±40% around the estimate. */
  lowMicroUsd: number;
  highMicroUsd: number;
  budgets: BudgetLeft[];
  /** No budget left in one scope: the run cannot start. */
  exhausted: boolean;
  /** The estimate uses more than 90% of what is left: an explicit confirmation is needed. */
  needsConfirmation: boolean;
  /** About how many items fit in the budget left, when not all of them do. */
  fitsItems: number | null;
}

export async function estimateRun(
  db: Database,
  input: { clientId: string; items: number; stopAt: AutomationStopPoint },
): Promise<StartEstimate> {
  const cost = await costPerItem(db);
  const per = cost.outline + (input.stopAt === "slides" ? cost.slides : 0);
  const total = per * input.items;
  const budgets = await budgetsLeft(db, input.clientId);
  const left = budgets.length ? Math.min(...budgets.map((b) => b.leftMicroUsd)) : null;
  return {
    items: input.items,
    perItemMicroUsd: per,
    totalMicroUsd: total,
    lowMicroUsd: Math.round(total * 0.6),
    highMicroUsd: Math.round(total * 1.4),
    budgets,
    exhausted: left !== null && left <= 0,
    needsConfirmation: left !== null && total > (left * CONFIRM_BUDGET_PERCENT) / 100,
    fitsItems: left !== null && total > left && per > 0 ? Math.floor(left / per) : null,
  };
}

/** Policies under which the automation cannot start; local_only needs a local model. */
export function policyBlocker(
  policy: AiPolicy,
  localModel: boolean,
): "noAi" | "localOnlyNoModel" | null {
  if (policy === "no_ai") return "noAi";
  if (policy === "local_only" && !localModel) return "localOnlyNoModel";
  return null;
}

// ---- Running ----

export interface RunDeps {
  db: Database;
  queues: JobQueues;
  /** True when a local model is configured (local_only clients). */
  localModel: boolean;
}

async function activeRun(db: Database, automationId: string) {
  const [run] = await db
    .select()
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.automationId, automationId),
        inArray(automationRuns.status, ["running", "paused"]),
      ),
    )
    .orderBy(desc(automationRuns.number))
    .limit(1);
  return run ?? null;
}

/**
 * Queues the next queued item of a run, if the automation is still active. One caller at a
 * time per run: "pick the next item, enqueue, claim" is not atomic on its own, and two
 * callers (the handler of the previous item and a resume, say) would otherwise enqueue the
 * same item twice and the second job would fail the live one.
 * ponytail: a crash between enqueueJob and the claim can still leave one extra job for the
 * item; the handler's compare-and-set makes it a no-op, so only a leaked row remains.
 */
export async function queueNextItem(
  deps: Pick<RunDeps, "db" | "queues">,
  runId: string,
): Promise<AutomationRunItemRow | null> {
  // ponytail: the lock holds one pooled connection while the body uses others, so this needs
  // pool >= 2 plus concurrent callers; a pool of 1 would deadlock on itself.
  return deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`automation_run:${runId}`}))`);
    // The lock lives as long as this transaction; the work below commits on its own
    // connections, which the next caller can only observe after the lock is released.
    return pickAndQueueItem(deps, runId);
  });
}

async function pickAndQueueItem(
  deps: Pick<RunDeps, "db" | "queues">,
  runId: string,
): Promise<AutomationRunItemRow | null> {
  const { db } = deps;
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
  if (!run || run.status !== "running") return null;
  const [automation] = await db
    .select({ status: automations.status })
    .from(automations)
    .where(eq(automations.id, run.automationId));
  // Cancelled while an item was running: the run closes once that item is done.
  if (automation?.status !== "active") {
    await finishRun(db, runId);
    return null;
  }
  // Busy: an item is running, or already queued with a job attached (claimed by an earlier
  // caller). Pause/resume clear job_id and a crash before the claim leaves it null, so a stale
  // job_id cannot block the run for good.
  const busy = await db
    .select({ id: automationRunItems.id })
    .from(automationRunItems)
    .where(
      and(
        eq(automationRunItems.runId, runId),
        or(
          eq(automationRunItems.status, "running"),
          and(
            eq(automationRunItems.status, "queued"),
            sql`${automationRunItems.jobId} is not null`,
          ),
        ),
      ),
    )
    .limit(1);
  if (busy.length) return null;
  const [next] = await db
    .select()
    .from(automationRunItems)
    .where(
      and(
        eq(automationRunItems.runId, runId),
        eq(automationRunItems.status, "queued"),
        isNull(automationRunItems.jobId),
      ),
    )
    .orderBy(automationRunItems.position)
    .limit(1);
  if (!next) {
    await finishRun(db, runId);
    return null;
  }
  const job = await enqueueJob(db, deps.queues, {
    kind: automationItemJob,
    payload: { runItemId: next.id },
    clientId: run.clientId,
    entity: "automation_run_item",
    entityId: next.id,
    createdBy: run.startedBy,
  });
  const [claimed] = await db
    .update(automationRunItems)
    .set({ jobId: job.id, updatedAt: new Date() })
    .where(and(eq(automationRunItems.id, next.id), isNull(automationRunItems.jobId)))
    .returning();
  return claimed ?? null;
}

/** Final status of a run whose items are all done. */
export function runOutcome(c: RunCounts): AutomationRunRow["status"] {
  if (c.failed > 0) return c.completed > 0 ? "partial" : "failed";
  return c.cancelled > 0 ? "cancelled" : "completed";
}

/** Closes a run whose items are all done: completed, partial (some failed) or failed. */
export async function finishRun(db: Database, runId: string) {
  const counts = (await countsFor(db, [runId])).get(runId);
  if (!counts || counts.queued > 0 || counts.running > 0) return;
  const status = runOutcome(counts);
  const [closed] = await db
    .update(automationRuns)
    .set({ status, endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(automationRuns.id, runId), inArray(automationRuns.status, ["running", "paused"])))
    .returning({ id: automationRuns.id });
  // The automation stays “active” only while a run is in progress.
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
  if (!run) return;
  await db
    .update(automations)
    .set({ status: "draft", statusReason: null, updatedAt: new Date() })
    .where(and(eq(automations.id, run.automationId), eq(automations.status, "active")));
  // Whoever started it hears once how it ended; a cancelled run was someone's own choice.
  if (closed && status !== "cancelled") {
    const [a] = await db
      .select({ name: automations.name, clientId: automations.clientId })
      .from(automations)
      .where(eq(automations.id, run.automationId));
    if (a)
      await notify(db, {
        kind: "automation_run_finished",
        to: [run.startedBy],
        clientId: a.clientId,
        params: {
          name: a.name,
          completed: counts.completed,
          failed: counts.failed,
          total: counts.total,
        },
        href: `/automations/${run.automationId}?tab=runs&run=${run.id}`,
      });
  }
}

async function createRun(
  deps: RunDeps,
  actor: Extract<Actor, { type: "user" }>,
  row: AutomationRow,
  items: Array<{ key: string; title: string; input: AutomationItem }>,
  estimateMicroUsd: number,
) {
  const { db } = deps;
  const run = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`automation:${row.id}`}))`);
    const [busy] = await tx
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automationId, row.id),
          inArray(automationRuns.status, ["running", "paused"]),
        ),
      );
    if (busy) fail("conflict", "automations.errors.alreadyRunning");
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${automationRuns.number}), 0)::int` })
      .from(automationRuns)
      .where(eq(automationRuns.automationId, row.id));
    const [created] = await tx
      .insert(automationRuns)
      .values({
        automationId: row.id,
        clientId: row.clientId,
        number: (last?.n ?? 0) + 1,
        stopAt: row.stopAt,
        estimateMicroUsd,
        startedBy: actor.id,
      })
      .returning();
    await tx.insert(automationRunItems).values(
      items.map((it, position) => ({
        runId: created!.id,
        automationId: row.id,
        position,
        itemKey: it.key,
        title: it.title,
        input: { ...it.input, params: readParams(row.params) },
      })),
    );
    await tx
      .update(automations)
      .set({ status: "active", statusReason: null, updatedAt: new Date() })
      .where(eq(automations.id, row.id));
    return created!;
  });
  await queueNextItem(deps, run.id);
  return run;
}

async function startChecks(
  deps: RunDeps,
  actor: Actor,
  row: AutomationRow,
  itemCount: number,
  confirmCost: boolean,
) {
  const [client] = await deps.db.select().from(clients).where(eq(clients.id, row.clientId));
  if (!client) fail("not_found", "automations.errors.notFound");
  const blocker = policyBlocker(client!.aiPolicy, deps.localModel);
  if (blocker)
    fail("policy_blocked", `automations.errors.policy.${blocker}`, undefined, {
      code: "POLICY-BLOCKED",
    });
  // Every carousel speaks to at least one live audience of the published Brand Identity.
  if (!readParams(row.params).audienceIds.length) {
    const brand = await getPublishedBrandIdentity(deps.db, actor, row.clientId);
    if (!brand?.document.strategy.audience.some((a) => !a.deprecated))
      fail("validation", "automations.errors.noAudience", undefined, { code: "NO-AUDIENCE" });
  }
  const estimate = await estimateRun(deps.db, {
    clientId: row.clientId,
    items: itemCount,
    stopAt: row.stopAt,
  });
  if (estimate.exhausted)
    fail("budget_exceeded", "automations.errors.budgetExhausted", undefined, {
      code: "BUDGET-EXCEEDED",
    });
  if (estimate.needsConfirmation && !confirmCost)
    fail("validation", "automations.errors.confirmCost", undefined, { estimate });
  humanOnly(actor, "edit_draft", row.clientId);
  return estimate;
}

/** “Start automation”: a run with one queued item per configuration item (page 59). */
export async function startAutomation(
  deps: RunDeps,
  actor: Actor,
  input: { id: string; confirmCost?: boolean },
): Promise<AutomationRunRow> {
  const row = await requireAutomation(deps.db, input.id);
  humanOnly(actor, "edit_draft", row.clientId);
  if (row.status === "failed") fail("conflict", "automations.errors.failedFinal");
  if (row.status === "active" || row.status === "paused")
    fail("conflict", "automations.errors.alreadyRunning");
  const items = readItems(row.items);
  const blockers = configBlockers(items);
  if (blockers.length) fail("validation", "automations.errors.notReady", undefined, { blockers });
  const estimate = await startChecks(deps, actor, row, items.length, !!input.confirmCost);
  return createRun(
    deps,
    actor,
    row,
    items.map((i) => ({ key: i.id, title: i.title, input: i })),
    estimate.totalMicroUsd,
  );
}

/** A new run with only the failed items of the last run (same checks as starting). */
export async function retryFailedItems(
  deps: RunDeps,
  actor: Actor,
  input: { id: string; confirmCost?: boolean },
): Promise<AutomationRunRow> {
  const row = await requireAutomation(deps.db, input.id);
  humanOnly(actor, "edit_draft", row.clientId);
  if (row.status !== "draft") fail("conflict", "automations.errors.alreadyRunning");
  const [last] = await deps.db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, row.id))
    .orderBy(desc(automationRuns.number))
    .limit(1);
  const failed = last
    ? await deps.db
        .select()
        .from(automationRunItems)
        .where(and(eq(automationRunItems.runId, last.id), eq(automationRunItems.status, "failed")))
        .orderBy(automationRunItems.position)
    : [];
  if (!failed.length) fail("validation", "automations.errors.nothingToRetry");
  const estimate = await startChecks(deps, actor, row, failed.length, !!input.confirmCost);
  return createRun(
    deps,
    actor,
    row,
    failed.map((f) => ({
      key: f.itemKey,
      title: f.title,
      input: readItems([f.input])[0] ?? (f.input as AutomationItem),
    })),
    estimate.totalMicroUsd,
  );
}

/** The item in progress finishes; the next ones wait (no confirmation, page 58). */
export async function pauseAutomation(
  db: Database,
  actor: Actor,
  input: { id: string },
  reason: { key: MessageKey; values?: Record<string, unknown> } | null = null,
) {
  const row = await requireAutomation(db, input.id);
  humanOnly(actor, "edit_draft", row.clientId);
  if (row.status !== "active") fail("conflict", "automations.errors.notRunning");
  await pauseRows(db, row.id, reason);
}

/** Pauses an automation and its run; also used by the worker when the budget runs out. */
export async function pauseRows(
  db: Database,
  automationId: string,
  reason: { key: MessageKey; values?: Record<string, unknown> } | null,
) {
  await db
    .update(automations)
    .set({ status: "paused", statusReason: reason, updatedAt: new Date() })
    .where(and(eq(automations.id, automationId), eq(automations.status, "active")));
  await db
    .update(automationRuns)
    .set({ status: "paused", updatedAt: new Date() })
    .where(
      and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, "running")),
    );
}

/** Resumes a paused run from its next queued item (policy and budget are checked again). */
export async function resumeAutomation(
  deps: RunDeps,
  actor: Actor,
  input: { id: string; confirmCost?: boolean },
) {
  const row = await requireAutomation(deps.db, input.id);
  humanOnly(actor, "edit_draft", row.clientId);
  if (row.status !== "paused") fail("conflict", "automations.errors.notPaused");
  const run = await activeRun(deps.db, row.id);
  if (!run) fail("conflict", "automations.errors.notPaused");
  const remaining = (await countsFor(deps.db, [run!.id])).get(run!.id)?.queued ?? 0;
  await startChecks(deps, actor, row, remaining, !!input.confirmCost);
  await deps.db
    .update(automations)
    .set({ status: "active", statusReason: null, updatedAt: new Date() })
    .where(and(eq(automations.id, row.id), eq(automations.status, "paused")));
  await deps.db
    .update(automationRuns)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(automationRuns.id, run!.id));
  // Items that were queued but never claimed by the worker are queued again.
  await deps.db
    .update(automationRunItems)
    .set({ jobId: null })
    .where(and(eq(automationRunItems.runId, run!.id), eq(automationRunItems.status, "queued")));
  await queueNextItem(deps, run!.id);
}

/** Queued items become cancelled; carousels already created stay drafts. */
export async function cancelRun(db: Database, actor: Actor, input: { id: string }) {
  const row = await requireAutomation(db, input.id);
  humanOnly(actor, "edit_draft", row.clientId);
  const run = await activeRun(db, row.id);
  if (!run) fail("conflict", "automations.errors.notRunning");
  await cancelRows(db, run!.id);
  await db
    .update(automations)
    .set({ status: "draft", statusReason: null, updatedAt: new Date() })
    .where(and(eq(automations.id, row.id), inArray(automations.status, ["active", "paused"])));
}

export async function cancelRows(db: Database, runId: string) {
  await db
    .update(automationRunItems)
    .set({ status: "cancelled", endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(automationRunItems.runId, runId), eq(automationRunItems.status, "queued")));
  const counts = (await countsFor(db, [runId])).get(runId);
  if (!counts?.running)
    await db
      .update(automationRuns)
      .set({
        status: counts ? runOutcome(counts) : "cancelled",
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(automationRuns.id, runId), inArray(automationRuns.status, ["running", "paused"])),
      );
}

/** The client's policy changed to no AI: the automation fails for good (page 58, AI state). */
export async function failForPolicy(db: Database, automationId: string, runId: string) {
  await db
    .update(automations)
    .set({
      status: "failed",
      statusReason: { key: "automations.status.policyChanged" },
      updatedAt: new Date(),
    })
    .where(eq(automations.id, automationId));
  await cancelRows(db, runId);
  await db
    .update(automationRuns)
    .set({ status: "failed", endedAt: new Date(), updatedAt: new Date() })
    .where(eq(automationRuns.id, runId));
}
