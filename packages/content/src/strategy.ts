/**
 * Content Strategy (spec pages 31–34): pillars, rubrics and the 30-day plan.
 * People create and edit items directly (status `accepted`); the Planner only
 * writes `proposed` rows, which a person accepts, edits or rejects. A proposal with
 * `targetId` would change an existing item and is applied onto it on acceptance.
 */
import type { Actor } from "@forgecy/core";
import {
  and,
  contentPillars,
  contentPlanItems,
  contentPlans,
  contentRubrics,
  eq,
  inArray,
  ne,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import {
  conflict,
  humanOnly,
  invalid,
  notFound,
  parseOrThrow,
  requireClient,
  revConflict,
  type Executor,
} from "./access";
import {
  pillarInputSchema,
  planItemInputSchema,
  provenanceSchema,
  rubricInputSchema,
  type PillarInput,
  type PillarInputRaw,
  type PlanItemInput,
  type PlanItemInputRaw,
  type Provenance,
  type RubricInput,
  type RubricInputRaw,
} from "./document";
import { filterApprovedProductIds } from "./products";
import { assertCan } from "@forgecy/core";

export type StrategyKind = "pillar" | "rubric" | "plan_item";

const entityOf: Record<StrategyKind, string> = {
  pillar: "content_pillar",
  rubric: "content_rubric",
  plan_item: "content_plan_item",
};

async function audit(
  db: Executor,
  actor: Actor,
  action: string,
  kind: StrategyKind | "plan",
  entityId: string,
  clientId: string,
  meta: Record<string, unknown> = {},
) {
  await recordAuditEvent(db, {
    actor,
    action: `content.${action}`,
    entity: kind === "plan" ? "content_plan" : entityOf[kind],
    entityId,
    clientId,
    meta,
  });
}

// ---- Row values ----

function pillarValues(p: PillarInput) {
  return {
    name: p.name,
    goal: p.goal,
    audienceIds: p.audienceIds,
    funnel: p.funnel,
    themes: p.themes,
    frequencyCount: p.frequency?.count ?? null,
    frequencyUnit: p.frequency?.unit ?? null,
    cta: p.cta || null,
    emotion: p.emotion || null,
    examples: p.examples as unknown as Record<string, unknown>[],
    forbidden: p.forbidden,
    productIds: p.productIds,
  };
}

function rubricValues(r: RubricInput) {
  return {
    pillarId: r.pillarId,
    name: r.name,
    frequencyCount: r.frequency?.count ?? null,
    frequencyUnit: r.frequency?.unit ?? null,
    structure: r.structure as unknown as Record<string, unknown>[],
    hookFormula: r.hookFormula || null,
    hookExample: r.hookExample || null,
    cta: r.cta || null,
    templateKey: r.templateKey,
    channels: r.channels,
    ownerId: r.ownerId,
    productIds: r.productIds,
  };
}

function planItemValues(i: PlanItemInput) {
  return {
    day: i.day,
    channel: i.channel,
    format: i.format,
    pillarId: i.pillarId,
    rubricId: i.rubricId,
    theme: i.theme,
    hook: i.hook || null,
    notes: i.notes || null,
    productIds: i.productIds,
  };
}

async function cleanProducts<T extends { productIds: string[] }>(
  db: Database,
  clientId: string,
  v: T,
): Promise<T> {
  return { ...v, productIds: await filterApprovedProductIds(db, clientId, v.productIds) };
}

async function requirePillar(db: Executor, clientId: string, id: string, allowProposed = false) {
  const [p] = await db
    .select({ id: contentPillars.id, status: contentPillars.status })
    .from(contentPillars)
    .where(and(eq(contentPillars.id, id), eq(contentPillars.clientId, clientId)));
  if (!p) notFound("Pilastro non trovato");
  if (p.status !== "accepted" && !(allowProposed && p.status === "proposed"))
    invalid("Il pilastro non è attivo");
  return p;
}

async function requireRubric(db: Executor, clientId: string, id: string, pillarId?: string) {
  const [r] = await db
    .select({
      id: contentRubrics.id,
      pillarId: contentRubrics.pillarId,
      status: contentRubrics.status,
    })
    .from(contentRubrics)
    .where(and(eq(contentRubrics.id, id), eq(contentRubrics.clientId, clientId)));
  if (!r) notFound("Rubrica non trovata");
  if (pillarId && r.pillarId !== pillarId) invalid("La rubrica appartiene a un altro pilastro");
  return r;
}

// ---- Pillars ----

export async function createPillar(
  db: Database,
  actor: Actor,
  clientId: string,
  raw: PillarInputRaw,
) {
  humanOnly(actor, "edit_draft", clientId);
  await requireClient(db, clientId);
  const input = parseOrThrow(pillarInputSchema, raw);
  const values = await cleanProducts(db, clientId, pillarValues(input));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contentPillars)
      .values({
        clientId,
        ...values,
        status: "accepted",
        createdBy: actor.id,
        updatedBy: actor.id,
        decidedBy: actor.id,
        decidedAt: new Date(),
      })
      .returning();
    await audit(tx, actor, "pillar_created", "pillar", row!.id, clientId, { name: input.name });
    return row!;
  });
}

export async function updatePillar(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; rev: number; values: PillarInputRaw },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const parsed = parseOrThrow(pillarInputSchema, input.values);
  const values = await cleanProducts(db, input.clientId, pillarValues(parsed));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(contentPillars)
      .set({ ...values, rev: sql`${contentPillars.rev} + 1`, updatedBy: actor.id })
      .where(
        and(
          eq(contentPillars.id, input.id),
          eq(contentPillars.clientId, input.clientId),
          eq(contentPillars.rev, input.rev),
          inArray(contentPillars.status, ["accepted", "proposed", "stale"]),
        ),
      )
      .returning();
    if (!row) return staleOrMissing(tx, "pillar", input.id, input.clientId);
    await audit(tx, actor, "pillar_updated", "pillar", row.id, input.clientId);
    return row;
  });
}

// ---- Rubrics ----

export async function createRubric(
  db: Database,
  actor: Actor,
  clientId: string,
  raw: RubricInputRaw,
) {
  humanOnly(actor, "edit_draft", clientId);
  await requireClient(db, clientId);
  const input = parseOrThrow(rubricInputSchema, raw);
  await requirePillar(db, clientId, input.pillarId);
  const values = await cleanProducts(db, clientId, rubricValues(input));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contentRubrics)
      .values({
        clientId,
        ...values,
        status: "accepted",
        createdBy: actor.id,
        updatedBy: actor.id,
        decidedBy: actor.id,
        decidedAt: new Date(),
      })
      .returning();
    await audit(tx, actor, "rubric_created", "rubric", row!.id, clientId, { name: input.name });
    return row!;
  });
}

export async function updateRubric(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; rev: number; values: RubricInputRaw },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const parsed = parseOrThrow(rubricInputSchema, input.values);
  await requirePillar(db, input.clientId, parsed.pillarId, true);
  const values = await cleanProducts(db, input.clientId, rubricValues(parsed));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(contentRubrics)
      .set({ ...values, rev: sql`${contentRubrics.rev} + 1`, updatedBy: actor.id })
      .where(
        and(
          eq(contentRubrics.id, input.id),
          eq(contentRubrics.clientId, input.clientId),
          eq(contentRubrics.rev, input.rev),
          inArray(contentRubrics.status, ["accepted", "proposed", "stale"]),
        ),
      )
      .returning();
    if (!row) return staleOrMissing(tx, "rubric", input.id, input.clientId);
    await audit(tx, actor, "rubric_updated", "rubric", row.id, input.clientId);
    return row;
  });
}

// ---- Shared lifecycle ----

const tableOf = {
  pillar: contentPillars,
  rubric: contentRubrics,
  plan_item: contentPlanItems,
} as const;

async function staleOrMissing(
  db: Executor,
  kind: StrategyKind,
  id: string,
  clientId: string,
): Promise<never> {
  const t = tableOf[kind];
  const [cur] = await db
    .select({ rev: t.rev, updatedBy: t.updatedBy, updatedAt: t.updatedAt, status: t.status })
    .from(t)
    .where(and(eq(t.id, id), eq(t.clientId, clientId)));
  if (!cur) notFound("Elemento non trovato");
  if (cur.status === "archived" || cur.status === "rejected")
    conflict("Elemento archiviato o rifiutato: ripristinalo prima di modificarlo");
  return revConflict({
    rev: cur.rev,
    updatedBy: cur.updatedBy,
    updatedAt: cur.updatedAt.toISOString(),
  });
}

/** Archive an item (not deleted: carousels keep pointing at it). Archiving a pillar archives its rubrics. */
export async function archiveStrategyItem(
  db: Database,
  actor: Actor,
  input: { clientId: string; kind: StrategyKind; id: string },
) {
  humanOnly(actor, "archive", input.clientId);
  const t = tableOf[input.kind];
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(t)
      .set({ status: "archived", archivedAt: now, updatedBy: actor.id })
      .where(and(eq(t.id, input.id), eq(t.clientId, input.clientId), ne(t.status, "archived")))
      .returning({ id: t.id });
    if (!row) notFound("Elemento non trovato o già archiviato");
    if (input.kind === "pillar")
      await tx
        .update(contentRubrics)
        .set({ status: "archived", archivedAt: now, updatedBy: actor.id })
        .where(
          and(
            eq(contentRubrics.pillarId, input.id),
            inArray(contentRubrics.status, ["accepted", "stale"]),
          ),
        );
    await audit(tx, actor, `${input.kind}_archived`, input.kind, input.id, input.clientId);
    return row;
  });
}

export async function restoreStrategyItem(
  db: Database,
  actor: Actor,
  input: { clientId: string; kind: StrategyKind; id: string },
) {
  humanOnly(actor, "archive", input.clientId);
  const t = tableOf[input.kind];
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(t)
      .set({ status: "accepted", archivedAt: null, updatedBy: actor.id, rev: sql`${t.rev} + 1` })
      .where(and(eq(t.id, input.id), eq(t.clientId, input.clientId), eq(t.status, "archived")))
      .returning({ id: t.id });
    if (!row) notFound("Elemento non trovato o non archiviato");
    await audit(tx, actor, `${input.kind}_restored`, input.kind, input.id, input.clientId);
    return row;
  });
}

// ---- Planner proposals ----

export interface ProposedPillar {
  targetId?: string | null;
  values: PillarInputRaw;
}
export interface ProposedRubric {
  targetId?: string | null;
  /** Rubric of a pillar proposed in the same batch: index in `pillars`. */
  pillarIndex?: number;
  values: Omit<RubricInputRaw, "pillarId"> & { pillarId?: string };
}

/**
 * Store Planner proposals (agents only hold `propose`). Earlier open proposals of the
 * same kind become `stale`, so the list never shows two competing suggestions.
 */
export async function saveStrategyProposals(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    brandVersionId: string | null;
    provenance: Provenance;
    pillars: ProposedPillar[];
    rubrics: ProposedRubric[];
  },
) {
  assertCan(actor, "propose", input.clientId);
  const prov = provenanceSchema.parse(input.provenance) as unknown as Record<string, unknown>;
  const pillars = input.pillars.map((p) => ({
    targetId: p.targetId ?? null,
    v: pillarInputSchema.parse(p.values),
  }));
  return db.transaction(async (tx) => {
    const now = new Date();
    if (pillars.length)
      await tx
        .update(contentPillars)
        .set({ status: "stale" })
        .where(
          and(eq(contentPillars.clientId, input.clientId), eq(contentPillars.status, "proposed")),
        );
    if (input.rubrics.length)
      await tx
        .update(contentRubrics)
        .set({ status: "stale" })
        .where(
          and(eq(contentRubrics.clientId, input.clientId), eq(contentRubrics.status, "proposed")),
        );

    const pillarIds: string[] = [];
    for (const p of pillars) {
      if (p.targetId) await requirePillar(tx, input.clientId, p.targetId);
      const values = await cleanProducts(db, input.clientId, pillarValues(p.v));
      const [row] = await tx
        .insert(contentPillars)
        .values({
          clientId: input.clientId,
          targetId: p.targetId,
          ...values,
          status: "proposed",
          provenance: prov,
          brandVersionId: input.brandVersionId,
          createdAt: now,
        })
        .returning({ id: contentPillars.id });
      pillarIds.push(row!.id);
    }
    const rubricIds: string[] = [];
    for (const r of input.rubrics) {
      const pillarId =
        r.pillarIndex !== undefined ? pillarIds[r.pillarIndex] : (r.values.pillarId ?? undefined);
      if (!pillarId) continue;
      if (r.pillarIndex === undefined) await requirePillar(tx, input.clientId, pillarId);
      if (r.targetId) await requireRubric(tx, input.clientId, r.targetId);
      const v = rubricInputSchema.parse({ ...r.values, pillarId });
      const values = await cleanProducts(db, input.clientId, rubricValues(v));
      const [row] = await tx
        .insert(contentRubrics)
        .values({
          clientId: input.clientId,
          targetId: r.targetId ?? null,
          ...values,
          status: "proposed",
          provenance: prov,
          brandVersionId: input.brandVersionId,
        })
        .returning({ id: contentRubrics.id });
      rubricIds.push(row!.id);
    }
    await recordAuditEvent(tx, {
      actor,
      action: "content.strategy_proposed",
      entity: "client",
      entityId: input.clientId,
      clientId: input.clientId,
      meta: {
        pillars: pillarIds.length,
        rubrics: rubricIds.length,
        jobId: input.provenance.jobId ?? null,
      },
    });
    return { pillarIds, rubricIds };
  });
}

/**
 * A person accepts (optionally with edits) or rejects a proposal. Accepting an update
 * proposal copies its values onto the target and keeps the proposal as history.
 */
export async function decideStrategyProposal(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    kind: "pillar" | "rubric";
    id: string;
    decision: "accept" | "reject";
    note?: string;
    /** Edited values ("Modifica e accetta"). */
    values?: PillarInputRaw | RubricInputRaw;
  },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const note = input.note?.trim().slice(0, 1000) || null;
  return db.transaction(async (tx) => {
    const now = new Date();
    const decided = {
      decidedBy: actor.id,
      decidedAt: now,
      decisionNote: note,
      updatedBy: actor.id,
    };
    if (input.kind === "pillar") {
      const [p] = await tx
        .select()
        .from(contentPillars)
        .where(and(eq(contentPillars.id, input.id), eq(contentPillars.clientId, input.clientId)))
        .for("update");
      if (!p) notFound("Proposta non trovata");
      if (p.status !== "proposed") conflict("Questa proposta è già stata decisa o è superata");
      if (input.decision === "reject") {
        await tx
          .update(contentPillars)
          .set({ status: "rejected", ...decided })
          .where(eq(contentPillars.id, p.id));
        // Rubrics proposed under a rejected pillar go with it.
        await tx
          .update(contentRubrics)
          .set({ status: "rejected", ...decided })
          .where(and(eq(contentRubrics.pillarId, p.id), eq(contentRubrics.status, "proposed")));
      } else {
        const edited = input.values
          ? pillarValues(parseOrThrow(pillarInputSchema, input.values))
          : null;
        if (p.targetId) {
          const v = edited ?? pillarValues(pillarInputSchema.parse(pillarRowToInput(p)));
          await tx
            .update(contentPillars)
            .set({ ...v, rev: sql`${contentPillars.rev} + 1`, updatedBy: actor.id })
            .where(eq(contentPillars.id, p.targetId));
        }
        await tx
          .update(contentPillars)
          .set({ ...(edited && !p.targetId ? edited : {}), status: "accepted", ...decided })
          .where(eq(contentPillars.id, p.id));
        if (p.targetId)
          // The proposal stays as history; the live pillar is the target.
          await tx
            .update(contentPillars)
            .set({ status: "archived", archivedAt: now })
            .where(eq(contentPillars.id, p.id));
      }
    } else {
      const [r] = await tx
        .select()
        .from(contentRubrics)
        .where(and(eq(contentRubrics.id, input.id), eq(contentRubrics.clientId, input.clientId)))
        .for("update");
      if (!r) notFound("Proposta non trovata");
      if (r.status !== "proposed") conflict("Questa proposta è già stata decisa o è superata");
      if (input.decision === "reject") {
        await tx
          .update(contentRubrics)
          .set({ status: "rejected", ...decided })
          .where(eq(contentRubrics.id, r.id));
      } else {
        const [pillar] = await tx
          .select({ status: contentPillars.status })
          .from(contentPillars)
          .where(eq(contentPillars.id, r.pillarId));
        if (pillar?.status !== "accepted") conflict("Accetta prima il pilastro di questa rubrica");
        const edited = input.values
          ? rubricValues(parseOrThrow(rubricInputSchema, input.values))
          : null;
        if (r.targetId) {
          const v = edited ?? rubricValues(rubricInputSchema.parse(rubricRowToInput(r)));
          await tx
            .update(contentRubrics)
            .set({ ...v, rev: sql`${contentRubrics.rev} + 1`, updatedBy: actor.id })
            .where(eq(contentRubrics.id, r.targetId));
          await tx
            .update(contentRubrics)
            .set({ status: "archived", archivedAt: now, ...decided })
            .where(eq(contentRubrics.id, r.id));
        } else {
          await tx
            .update(contentRubrics)
            .set({ ...(edited ?? {}), status: "accepted", ...decided })
            .where(eq(contentRubrics.id, r.id));
        }
      }
    }
    await audit(
      tx,
      actor,
      `${input.kind}_proposal_${input.decision}ed`,
      input.kind,
      input.id,
      input.clientId,
      {
        ...(note ? { note } : {}),
      },
    );
    return { ok: true as const };
  });
}

// ---- Row → input (forms and «Modifica e accetta») ----

type PillarRow = typeof contentPillars.$inferSelect;
type RubricRow = typeof contentRubrics.$inferSelect;
type PlanItemRow = typeof contentPlanItems.$inferSelect;

const freq = (count: number | null, unit: "week" | "month" | null) =>
  count && unit ? { count, unit } : null;

export function pillarRowToInput(p: PillarRow): PillarInputRaw {
  return {
    name: p.name,
    goal: p.goal,
    audienceIds: p.audienceIds,
    funnel: p.funnel,
    themes: p.themes,
    frequency: freq(p.frequencyCount, p.frequencyUnit),
    cta: p.cta ?? "",
    emotion: p.emotion ?? "",
    examples: p.examples as never,
    forbidden: p.forbidden,
    productIds: p.productIds,
  };
}

export function rubricRowToInput(r: RubricRow): RubricInputRaw {
  return {
    pillarId: r.pillarId,
    name: r.name,
    frequency: freq(r.frequencyCount, r.frequencyUnit),
    structure: r.structure as never,
    hookFormula: r.hookFormula ?? "",
    hookExample: r.hookExample ?? "",
    cta: r.cta ?? "",
    templateKey: r.templateKey,
    channels: r.channels as never,
    ownerId: r.ownerId,
    productIds: r.productIds,
  };
}

export function planItemRowToInput(i: PlanItemRow): PlanItemInputRaw {
  return {
    day: i.day,
    channel: i.channel as never,
    format: i.format as never,
    pillarId: i.pillarId ?? "",
    rubricId: i.rubricId,
    theme: i.theme,
    hook: i.hook ?? "",
    notes: i.notes ?? "",
    productIds: i.productIds,
  };
}

// ---- 30-day plan ----

async function nextPlanNumber(db: Executor, clientId: string) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(max(${contentPlans.number}), 0)::int` })
    .from(contentPlans)
    .where(eq(contentPlans.clientId, clientId));
  return (r?.n ?? 0) + 1;
}

/** The plan in use, creating an empty one the first time a person adds an item. */
export async function ensureActivePlan(db: Database, actor: Actor, clientId: string) {
  humanOnly(actor, "edit_draft", clientId);
  const [active] = await db
    .select()
    .from(contentPlans)
    .where(and(eq(contentPlans.clientId, clientId), eq(contentPlans.status, "active")));
  if (active) return active;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contentPlans)
      .values({
        clientId,
        number: await nextPlanNumber(tx, clientId),
        status: "active",
        createdBy: actor.id,
        acceptedBy: actor.id,
        acceptedAt: new Date(),
      })
      .returning();
    await audit(tx, actor, "plan_created", "plan", row!.id, clientId);
    return row!;
  });
}

async function checkPlanItemRefs(
  db: Executor,
  clientId: string,
  v: PlanItemInput,
  proposed = false,
) {
  await requirePillar(db, clientId, v.pillarId, proposed);
  if (v.rubricId) await requireRubric(db, clientId, v.rubricId, v.pillarId);
}

export async function addPlanItem(
  db: Database,
  actor: Actor,
  input: { clientId: string; planId: string; values: PlanItemInputRaw },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const v = parseOrThrow(planItemInputSchema, input.values);
  await checkPlanItemRefs(db, input.clientId, v);
  const [plan] = await db
    .select({ id: contentPlans.id, status: contentPlans.status })
    .from(contentPlans)
    .where(and(eq(contentPlans.id, input.planId), eq(contentPlans.clientId, input.clientId)));
  if (!plan) notFound("Piano non trovato");
  if (plan.status === "superseded") conflict("Questo piano è stato sostituito");
  const values = await cleanProducts(db, input.clientId, planItemValues(v));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contentPlanItems)
      .values({
        planId: plan.id,
        clientId: input.clientId,
        ...values,
        status: "accepted",
        createdBy: actor.id,
        updatedBy: actor.id,
        decidedBy: actor.id,
        decidedAt: new Date(),
      })
      .returning();
    await audit(tx, actor, "plan_item_created", "plan_item", row!.id, input.clientId, {
      day: v.day,
    });
    return row!;
  });
}

export async function updatePlanItem(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; rev: number; values: PlanItemInputRaw },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const v = parseOrThrow(planItemInputSchema, input.values);
  await checkPlanItemRefs(db, input.clientId, v, true);
  const values = await cleanProducts(db, input.clientId, planItemValues(v));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(contentPlanItems)
      .set({ ...values, rev: sql`${contentPlanItems.rev} + 1`, updatedBy: actor.id })
      .where(
        and(
          eq(contentPlanItems.id, input.id),
          eq(contentPlanItems.clientId, input.clientId),
          eq(contentPlanItems.rev, input.rev),
          inArray(contentPlanItems.status, ["accepted", "proposed", "stale"]),
        ),
      )
      .returning();
    if (!row) return staleOrMissing(tx, "plan_item", input.id, input.clientId);
    await audit(tx, actor, "plan_item_updated", "plan_item", row.id, input.clientId);
    return row;
  });
}

/** Planner plan: a new `proposed` plan with `proposed` items; the plan in use is untouched. */
export async function saveProposedPlan(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    brandVersionId: string | null;
    provenance: Provenance;
    items: PlanItemInputRaw[];
  },
) {
  assertCan(actor, "propose", input.clientId);
  const prov = provenanceSchema.parse(input.provenance) as unknown as Record<string, unknown>;
  const items: PlanItemInput[] = [];
  for (const raw of input.items) {
    const r = planItemInputSchema.safeParse(raw);
    if (!r.success) continue;
    try {
      await checkPlanItemRefs(db, input.clientId, r.data, true);
    } catch {
      continue; // cites a pillar or rubric that does not exist: dropped, never guessed
    }
    items.push(r.data);
  }
  if (!items.length) invalid("Il piano proposto non contiene elementi validi");
  return db.transaction(async (tx) => {
    // Only one open Planner plan at a time.
    await tx
      .update(contentPlans)
      .set({ status: "superseded" })
      .where(and(eq(contentPlans.clientId, input.clientId), eq(contentPlans.status, "proposed")));
    const [plan] = await tx
      .insert(contentPlans)
      .values({
        clientId: input.clientId,
        number: await nextPlanNumber(tx, input.clientId),
        status: "proposed",
        provenance: prov,
        brandVersionId: input.brandVersionId,
      })
      .returning();
    for (const i of items) {
      const values = await cleanProducts(db, input.clientId, planItemValues(i));
      await tx.insert(contentPlanItems).values({
        planId: plan!.id,
        clientId: input.clientId,
        ...values,
        status: "proposed",
        provenance: prov,
        brandVersionId: input.brandVersionId,
      });
    }
    await audit(tx, actor, "plan_proposed", "plan", plan!.id, input.clientId, {
      items: items.length,
    });
    return plan!;
  });
}

/** A person decides on single items of a proposed plan before accepting it. */
export async function decidePlanItem(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; decision: "accept" | "reject"; note?: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const [row] = await db
    .update(contentPlanItems)
    .set({
      status: input.decision === "accept" ? "accepted" : "rejected",
      decidedBy: actor.id,
      decidedAt: new Date(),
      decisionNote: input.note?.trim().slice(0, 1000) || null,
      updatedBy: actor.id,
    })
    .where(
      and(
        eq(contentPlanItems.id, input.id),
        eq(contentPlanItems.clientId, input.clientId),
        eq(contentPlanItems.status, "proposed"),
      ),
    )
    .returning({ id: contentPlanItems.id });
  if (!row) conflict("Elemento già deciso o non trovato");
  await audit(db, actor, `plan_item_${input.decision}ed`, "plan_item", row.id, input.clientId);
  return row;
}

/**
 * «Usa questo piano»: the proposed plan becomes the plan in use, its still-open items
 * are accepted, and the previous plan is kept as `superseded` (its carousels stay).
 * Items pointing at a pillar or rubric not accepted in the meantime are rejected.
 */
export async function activatePlan(
  db: Database,
  actor: Actor,
  input: { clientId: string; planId: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(contentPlans)
      .where(and(eq(contentPlans.id, input.planId), eq(contentPlans.clientId, input.clientId)))
      .for("update");
    if (!plan) notFound("Piano non trovato");
    if (plan.status !== "proposed") conflict("Si può usare solo un piano proposto");
    const now = new Date();
    await tx
      .update(contentPlans)
      .set({ status: "superseded" })
      .where(and(eq(contentPlans.clientId, input.clientId), eq(contentPlans.status, "active")));
    await tx
      .update(contentPlans)
      .set({ status: "active", acceptedBy: actor.id, acceptedAt: now })
      .where(eq(contentPlans.id, plan.id));
    await tx.execute(sql`
      update content_plan_items i
      set status = 'accepted', decided_by = ${actor.id}, decided_at = now(), updated_at = now()
      where i.plan_id = ${plan.id} and i.status = 'proposed'
        and exists (select 1 from content_pillars p where p.id = i.pillar_id and p.status = 'accepted')
        and (i.rubric_id is null
             or exists (select 1 from content_rubrics r where r.id = i.rubric_id and r.status = 'accepted'))`);
    await tx
      .update(contentPlanItems)
      .set({ status: "rejected", decidedBy: actor.id, decidedAt: now })
      .where(and(eq(contentPlanItems.planId, plan.id), eq(contentPlanItems.status, "proposed")));
    await audit(tx, actor, "plan_activated", "plan", plan.id, input.clientId, {
      number: plan.number,
    });
    return plan;
  });
}

/** Discard a proposed plan without touching the plan in use. */
export async function discardProposedPlan(
  db: Database,
  actor: Actor,
  input: { clientId: string; planId: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const [row] = await db
    .update(contentPlans)
    .set({ status: "superseded" })
    .where(
      and(
        eq(contentPlans.id, input.planId),
        eq(contentPlans.clientId, input.clientId),
        eq(contentPlans.status, "proposed"),
      ),
    )
    .returning({ id: contentPlans.id });
  if (!row) conflict("Piano non trovato o non più proposto");
  await audit(db, actor, "plan_discarded", "plan", row.id, input.clientId);
  return row;
}
