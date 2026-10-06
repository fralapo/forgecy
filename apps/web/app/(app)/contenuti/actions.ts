"use server";

import "./_lib/ports";

import { getPublishedBrandIdentity } from "@forgecy/brand";
import {
  activatePlan,
  addComment,
  addPlanItem,
  approveOutline,
  archiveStrategyItem,
  briefReady,
  createCarousel,
  createPillar,
  createRubric,
  decideAsset,
  decidePlanItem,
  decideReview,
  decideSlideEdit,
  decideStrategyProposal,
  discardProposedPlan,
  editSlideJob,
  ensureActivePlan,
  exportContentJob,
  generateImageJob,
  generateOutlineJob,
  generateSlidesJob,
  getContentRow,
  humanOnly,
  outlineOf,
  prepareExport,
  proposePlanJob,
  proposeStrategyJob,
  requestSlideEdit,
  resolveComment,
  restoreOutline,
  restoreStrategyItem,
  restoreVersion,
  saveBrief,
  saveDraft,
  saveOutline,
  saveVersion,
  setContentArchived,
  submitForReview,
  updateAssetAlt,
  updateParams,
  updatePillar,
  updatePlanItem,
  updateRubric,
  withdrawFromReview,
  type BriefInput,
  type CarouselDocumentInput,
  type CarouselParamsInput,
  type OutlineInput,
  type PillarInputRaw,
  type PlanItemInputRaw,
  type RubricInputRaw,
  type StrategyKind,
} from "@forgecy/content";
import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import { getDb, type Database } from "@forgecy/db";
import { enqueueJob, type JobDefinition } from "@forgecy/jobs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getQueues } from "@/lib/queues";
import { requireUser } from "@/lib/session";

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code?: string; details?: Record<string, unknown> };

const slugSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const uuid = z.uuid();

interface Ctx {
  db: Database;
  actor: Actor;
  userId: string;
}

async function run<T extends object>(
  slug: string,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<ActionResult<T>> {
  slugSchema.parse(slug);
  const user = await requireUser();
  try {
    const out = await fn({ db: getDb(), actor: user.actor, userId: user.id });
    revalidatePath(`/contenuti/${slug}`, "layout");
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof PermissionDeniedError)
      return { ok: false, error: "Non hai il permesso per questa azione.", code: "PERM-DENIED" };
    if (err instanceof ForgecyError) {
      const code = typeof err.details?.code === "string" ? err.details.code : err.code;
      return {
        ok: false,
        error: err.message,
        code,
        ...(err.details ? { details: err.details } : {}),
      };
    }
    throw err;
  }
}

async function enqueue<S extends z.ZodType>(
  ctx: Ctx,
  def: JobDefinition<S>,
  payload: z.input<S>,
  target: { clientId: string; entity: "content" | "client"; entityId: string },
) {
  const row = await enqueueJob(ctx.db, await getQueues(), {
    kind: def,
    payload,
    clientId: target.clientId,
    entity: target.entity,
    entityId: target.entityId,
    createdBy: ctx.userId,
  });
  return { jobId: row.id };
}

async function requirePublishedBrand(ctx: Ctx, clientId: string) {
  if (!(await getPublishedBrandIdentity(ctx.db, ctx.actor, clientId)))
    throw new ForgecyError("conflict", "Pubblica prima la Brand Identity del cliente", {
      code: "BRAND-NOT-PUBLISHED",
    });
}

// ---- Strategy ----

export async function savePillarAction(input: {
  slug: string;
  clientId: string;
  id?: string;
  rev?: number;
  values: PillarInputRaw;
}) {
  return run(input.slug, async ({ db, actor }) => {
    const clientId = uuid.parse(input.clientId);
    const row = input.id
      ? await updatePillar(db, actor, {
          clientId,
          id: uuid.parse(input.id),
          rev: input.rev ?? 0,
          values: input.values,
        })
      : await createPillar(db, actor, clientId, input.values);
    return { id: row.id };
  });
}

export async function saveRubricAction(input: {
  slug: string;
  clientId: string;
  id?: string;
  rev?: number;
  values: RubricInputRaw;
}) {
  return run(input.slug, async ({ db, actor }) => {
    const clientId = uuid.parse(input.clientId);
    const row = input.id
      ? await updateRubric(db, actor, {
          clientId,
          id: uuid.parse(input.id),
          rev: input.rev ?? 0,
          values: input.values,
        })
      : await createRubric(db, actor, clientId, input.values);
    return { id: row.id };
  });
}

const kindSchema = z.enum(["pillar", "rubric", "plan_item"]);

export async function archiveItemAction(input: {
  slug: string;
  clientId: string;
  kind: StrategyKind;
  id: string;
  restore?: boolean;
}) {
  return run(input.slug, async ({ db, actor }) => {
    const args = {
      clientId: uuid.parse(input.clientId),
      kind: kindSchema.parse(input.kind),
      id: uuid.parse(input.id),
    };
    if (input.restore) await restoreStrategyItem(db, actor, args);
    else await archiveStrategyItem(db, actor, args);
    return {};
  });
}

export async function decideProposalAction(input: {
  slug: string;
  clientId: string;
  kind: "pillar" | "rubric";
  id: string;
  decision: "accept" | "reject";
  note?: string;
}) {
  return run(input.slug, async ({ db, actor }) => {
    await decideStrategyProposal(db, actor, {
      clientId: uuid.parse(input.clientId),
      kind: z.enum(["pillar", "rubric"]).parse(input.kind),
      id: uuid.parse(input.id),
      decision: z.enum(["accept", "reject"]).parse(input.decision),
      ...(input.note ? { note: input.note } : {}),
    });
    return {};
  });
}

export async function askPlannerAction(input: {
  slug: string;
  clientId: string;
  instruction: string;
}) {
  return run(input.slug, async (ctx) => {
    const clientId = uuid.parse(input.clientId);
    humanOnly(ctx.actor, "propose", clientId);
    await requirePublishedBrand(ctx, clientId);
    return enqueue(
      ctx,
      proposeStrategyJob,
      { clientId, instruction: input.instruction.slice(0, 500), requestedBy: ctx.userId },
      { clientId, entity: "client", entityId: clientId },
    );
  });
}

// ---- Plan ----

export async function askPlanAction(input: {
  slug: string;
  clientId: string;
  instruction: string;
  channels: ("instagram" | "linkedin")[];
}) {
  return run(input.slug, async (ctx) => {
    const clientId = uuid.parse(input.clientId);
    humanOnly(ctx.actor, "propose", clientId);
    await requirePublishedBrand(ctx, clientId);
    return enqueue(
      ctx,
      proposePlanJob,
      {
        clientId,
        instruction: input.instruction.slice(0, 500),
        channels: input.channels,
        requestedBy: ctx.userId,
      },
      { clientId, entity: "client", entityId: clientId },
    );
  });
}

export async function savePlanItemAction(input: {
  slug: string;
  clientId: string;
  id?: string;
  rev?: number;
  values: PlanItemInputRaw;
}) {
  return run(input.slug, async ({ db, actor }) => {
    const clientId = uuid.parse(input.clientId);
    if (input.id) {
      const row = await updatePlanItem(db, actor, {
        clientId,
        id: uuid.parse(input.id),
        rev: input.rev ?? 0,
        values: input.values,
      });
      return { id: row.id };
    }
    const plan = await ensureActivePlan(db, actor, clientId);
    const row = await addPlanItem(db, actor, { clientId, planId: plan.id, values: input.values });
    return { id: row.id };
  });
}

export async function decidePlanItemAction(input: {
  slug: string;
  clientId: string;
  id: string;
  decision: "accept" | "reject";
}) {
  return run(input.slug, async ({ db, actor }) => {
    await decidePlanItem(db, actor, {
      clientId: uuid.parse(input.clientId),
      id: uuid.parse(input.id),
      decision: z.enum(["accept", "reject"]).parse(input.decision),
    });
    return {};
  });
}

export async function planDecisionAction(input: {
  slug: string;
  clientId: string;
  planId: string;
  decision: "activate" | "discard";
}) {
  return run(input.slug, async ({ db, actor }) => {
    const args = { clientId: uuid.parse(input.clientId), planId: uuid.parse(input.planId) };
    if (input.decision === "activate") await activatePlan(db, actor, args);
    else await discardProposedPlan(db, actor, args);
    return {};
  });
}

// ---- Carousels: setup ----

export async function createCarouselAction(input: {
  slug: string;
  clientId: string;
  params: CarouselParamsInput;
  brief: BriefInput;
}) {
  return run(input.slug, async ({ db, actor }) => {
    const row = await createCarousel(db, actor, {
      clientId: uuid.parse(input.clientId),
      params: input.params,
      brief: input.brief,
    });
    return { id: row.id };
  });
}

interface ContentRef {
  slug: string;
  clientId: string;
  id: string;
}
const ref = (r: ContentRef) => ({ clientId: uuid.parse(r.clientId), id: uuid.parse(r.id) });

export async function updateParamsAction(
  input: ContentRef & { briefRev: number; params: CarouselParamsInput; resetSlides?: boolean },
) {
  return run(input.slug, async ({ db, actor }) => {
    const row = await updateParams(db, actor, {
      ...ref(input),
      briefRev: input.briefRev,
      params: input.params,
      ...(input.resetSlides ? { resetSlides: true } : {}),
    });
    return { briefRev: row.briefRev };
  });
}

export async function saveBriefAction(input: ContentRef & { briefRev: number; brief: BriefInput }) {
  return run(input.slug, async ({ db, actor }) => {
    const row = await saveBrief(db, actor, {
      ...ref(input),
      briefRev: input.briefRev,
      brief: input.brief,
    });
    return { briefRev: row.briefRev };
  });
}

// ---- Outline ----

export async function generateOutlineAction(
  input: ContentRef & { instruction: string; keepEdited: boolean },
) {
  return run(input.slug, async (ctx) => {
    const r = ref(input);
    humanOnly(ctx.actor, "edit_draft", r.clientId);
    const c = await getContentRow(ctx.db, r.clientId, r.id);
    if (!briefReady(c.brief))
      throw new ForgecyError("validation", "Scrivi un brief di almeno 20 caratteri");
    return enqueue(
      ctx,
      generateOutlineJob,
      {
        clientId: r.clientId,
        contentId: r.id,
        instruction: input.instruction.slice(0, 500),
        keepEdited: input.keepEdited,
        requestedBy: ctx.userId,
      },
      { clientId: r.clientId, entity: "content", entityId: r.id },
    );
  });
}

export async function saveOutlineAction(
  input: ContentRef & { outlineNumber: number; outline: OutlineInput },
) {
  return run(input.slug, async ({ db, actor }) => {
    const row = await saveOutline(db, actor, {
      ...ref(input),
      outlineNumber: input.outlineNumber,
      outline: input.outline,
    });
    return { outlineNumber: row.outlineNumber };
  });
}

export async function restoreOutlineAction(input: ContentRef & { number: number }) {
  return run(input.slug, async ({ db, actor }) => {
    await restoreOutline(db, actor, { ...ref(input), number: input.number });
    return {};
  });
}

export async function approveOutlineAction(input: ContentRef & { outlineNumber: number }) {
  return run(input.slug, async ({ db, actor }) => {
    await approveOutline(db, actor, { ...ref(input), outlineNumber: input.outlineNumber });
    return {};
  });
}

export async function generateSlidesAction(input: ContentRef) {
  return run(input.slug, async (ctx) => {
    const r = ref(input);
    humanOnly(ctx.actor, "edit_draft", r.clientId);
    const c = await getContentRow(ctx.db, r.clientId, r.id);
    if (!outlineOf(c) || !c.outlineApprovedAt)
      throw new ForgecyError("validation", "Approva la scaletta prima di generare le slide");
    return enqueue(
      ctx,
      generateSlidesJob,
      { clientId: r.clientId, contentId: r.id, requestedBy: ctx.userId },
      { clientId: r.clientId, entity: "content", entityId: r.id },
    );
  });
}

// ---- Editor ----

export async function saveDraftAction(
  input: ContentRef & { draftRev: number; document: CarouselDocumentInput },
) {
  return run(input.slug, async ({ db, actor }) => {
    const row = await saveDraft(db, actor, {
      ...ref(input),
      draftRev: input.draftRev,
      document: input.document,
    });
    return { draftRev: row.draftRev };
  });
}

export async function saveVersionAction(input: ContentRef & { draftRev: number; note?: string }) {
  return run(input.slug, async ({ db, actor }) => {
    const v = await saveVersion(db, actor, {
      ...ref(input),
      draftRev: input.draftRev,
      ...(input.note ? { note: input.note } : {}),
    });
    return { number: v.number };
  });
}

export async function restoreVersionAction(input: ContentRef & { number: number }) {
  return run(input.slug, async ({ db, actor }) => {
    const v = await restoreVersion(db, actor, { ...ref(input), number: input.number });
    return { number: v.number };
  });
}

export async function requestSlideEditAction(
  input: ContentRef & { slideId: string; instruction: string },
) {
  return run(input.slug, async (ctx) => {
    const r = ref(input);
    const edit = await requestSlideEdit(ctx.db, ctx.actor, {
      ...r,
      slideId: input.slideId,
      instruction: input.instruction,
    });
    return enqueue(
      ctx,
      editSlideJob,
      { clientId: r.clientId, contentId: r.id, editId: edit.id, requestedBy: ctx.userId },
      { clientId: r.clientId, entity: "content", entityId: r.id },
    );
  });
}

export async function decideSlideEditAction(
  input: ContentRef & { editId: string; decision: "keep" | "revert" },
) {
  return run(input.slug, async ({ db, actor }) => {
    await decideSlideEdit(db, actor, {
      ...ref(input),
      editId: uuid.parse(input.editId),
      decision: z.enum(["keep", "revert"]).parse(input.decision),
    });
    return {};
  });
}

export async function generateImageAction(
  input: ContentRef & { slideId: string; slot: string; brief: string; variants: number },
) {
  return run(input.slug, async (ctx) => {
    const r = ref(input);
    humanOnly(ctx.actor, "edit_draft", r.clientId);
    await getContentRow(ctx.db, r.clientId, r.id);
    return enqueue(
      ctx,
      generateImageJob,
      {
        clientId: r.clientId,
        contentId: r.id,
        slideId: input.slideId,
        slot: input.slot,
        brief: input.brief,
        variants: input.variants,
        requestedBy: ctx.userId,
      },
      { clientId: r.clientId, entity: "content", entityId: r.id },
    );
  });
}

// ---- Review ----

export async function submitAction(input: ContentRef & { draftRev: number }) {
  return run(input.slug, async ({ db, actor }) => {
    const { version } = await submitForReview(db, actor, {
      ...ref(input),
      draftRev: input.draftRev,
    });
    return { number: version.number };
  });
}

export async function withdrawAction(input: ContentRef) {
  return run(input.slug, async ({ db, actor }) => withdrawFromReview(db, actor, ref(input)));
}

export async function decideReviewAction(
  input: ContentRef & {
    versionId: string;
    decision: "approved" | "changes_requested";
    note: string;
    acknowledged: string[];
  },
) {
  return run(input.slug, async ({ db, actor }) => {
    await decideReview(db, actor, {
      ...ref(input),
      versionId: uuid.parse(input.versionId),
      decision: z.enum(["approved", "changes_requested"]).parse(input.decision),
      note: input.note,
      acknowledged: input.acknowledged.slice(0, 200),
    });
    return {};
  });
}

export async function archiveContentAction(input: ContentRef & { archived: boolean }) {
  return run(input.slug, async ({ db, actor }) =>
    setContentArchived(db, actor, { ...ref(input), archived: input.archived }),
  );
}

export async function addCommentAction(
  input: ContentRef & { body: string; slideId?: string | null },
) {
  return run(input.slug, async ({ db, actor }) => {
    const row = await addComment(db, actor, {
      ...ref(input),
      body: input.body,
      slideId: input.slideId ?? null,
    });
    return { id: row.id };
  });
}

export async function resolveCommentAction(input: ContentRef & { commentId: string }) {
  return run(input.slug, async ({ db, actor }) => {
    await resolveComment(db, actor, { ...ref(input), commentId: uuid.parse(input.commentId) });
    return {};
  });
}

// ---- Export ----

export async function exportAction(
  input: ContentRef & { draft: boolean; outputs: ("png" | "pdf" | "zip")[] },
) {
  return run(input.slug, async (ctx) => {
    const r = ref(input);
    const { version } = await prepareExport(ctx.db, ctx.actor, { ...r, draft: input.draft });
    return enqueue(
      ctx,
      exportContentJob,
      {
        clientId: r.clientId,
        contentId: r.id,
        versionId: version.id,
        draft: input.draft,
        outputs: input.outputs.length ? input.outputs : ["zip"],
        requestedBy: ctx.userId,
      },
      { clientId: r.clientId, entity: "content", entityId: r.id },
    );
  });
}

// ---- Library ----

export async function decideAssetAction(input: {
  slug: string;
  clientId: string;
  id: string;
  decision: "approved" | "rejected";
  reason?: string;
}) {
  return run(input.slug, async ({ db, actor }) => {
    await decideAsset(db, actor, {
      clientId: uuid.parse(input.clientId),
      id: uuid.parse(input.id),
      decision: z.enum(["approved", "rejected"]).parse(input.decision),
      ...(input.reason ? { reason: input.reason } : {}),
    });
    return {};
  });
}

export async function updateAltAction(input: {
  slug: string;
  clientId: string;
  id: string;
  alt: string;
}) {
  return run(input.slug, async ({ db, actor }) => {
    await updateAssetAlt(db, actor, {
      clientId: uuid.parse(input.clientId),
      id: uuid.parse(input.id),
      alt: input.alt,
    });
    return {};
  });
}
