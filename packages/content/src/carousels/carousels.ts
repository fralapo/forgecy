/**
 * Carousels (spec pages 40–48): parameters and brief, outline, draft with autosave,
 * immutable versions, internal review and approval, exports. Every write is a
 * person's (`humanOnly`): agents write only through the generation pipeline, which
 * stores AI output as outlines, draft slides or slide edits a person then reviews.
 */
import { getPublishedBrandIdentity } from "@forgecy/brand";
import { transitionPermission, type Actor, type ContentStatus } from "@forgecy/core";
import { localizedError } from "@forgecy/i18n";
import {
  and,
  assets,
  contentApprovals,
  contentComments,
  contentExports,
  contentOutlines,
  contentPlanItems,
  contentPlans,
  contentRubrics,
  contentPillars,
  contentSlideEdits,
  contentVersions,
  contents,
  desc,
  eq,
  inArray,
  isNull,
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
} from "../access";
import {
  blockingChecks,
  computeChecks,
  warningChecks,
  type AssetInfo,
  type ContentCheck,
} from "./checks";
import {
  BRIEF_MIN_CHARS,
  briefSchema,
  carouselDocumentSchema,
  carouselParamsSchema,
  contentSlideSchema,
  newSlideId,
  normalizeHashtag,
  outlineSchema,
  parseDocument,
  type BriefInput,
  type CarouselDocument,
  type CarouselDocumentInput,
  type CarouselParamsInput,
  type ContentChannel,
  type Outline,
  type OutlineInput,
} from "../document";
import {
  brandGuard,
  carouselSubject,
  GUARDED_CHECK_PREFIXES,
  toGuardContent,
  type GuardAssetInfo,
  type GuardReport,
} from "./brand-guard";
import { productSource } from "../products";
import { clampSlideCount, getTemplate } from "./templates";

export type ContentRow = typeof contents.$inferSelect;

const EDITABLE: ContentStatus[] = ["draft", "changes_requested", "approved", "exported"];
const UNTITLED = "Untitled carousel";
// Rows created before the English UI still carry the old Italian default title.
const UNTITLED_TITLES = [UNTITLED, "Carosello senza titolo"];

async function audit(
  db: Executor,
  actor: Actor | "system",
  action: string,
  c: Pick<ContentRow, "id" | "clientId">,
  meta: Record<string, unknown> = {},
) {
  await recordAuditEvent(db, {
    actor,
    action: `content.${action}`,
    entity: "content",
    entityId: c.id,
    clientId: c.clientId,
    meta,
  });
}

export async function getContentRow(
  db: Executor,
  clientId: string,
  id: string,
): Promise<ContentRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound("content.errors.carouselNotFound");
  const [row] = await db
    .select()
    .from(contents)
    .where(and(eq(contents.id, id), eq(contents.clientId, clientId)));
  if (!row) notFound("content.errors.carouselNotFound");
  return row;
}

export function isLocked(c: Pick<ContentRow, "lockedByJobId" | "lockExpiresAt">, now = new Date()) {
  return Boolean(c.lockedByJobId && c.lockExpiresAt && c.lockExpiresAt > now);
}

function assertNotLocked(c: ContentRow) {
  if (isLocked(c))
    conflict("content.errors.aiWorking", {
      code: "CONTENT-LOCKED",
      jobId: c.lockedByJobId,
    });
}

/** Move the status through the core state machine, checking the permission it needs. */
function nextStatus(actor: Actor, c: ContentRow, to: ContentStatus) {
  if (c.status === to) return to;
  const permission = transitionPermission(c.status, to);
  if (!permission)
    conflict("content.errors.badTransition", { from: c.status, to }, { from: c.status, to });
  humanOnly(actor, permission, c.clientId);
  return to;
}

export function outlineOf(c: Pick<ContentRow, "outline">): Outline | null {
  const r = outlineSchema.safeParse(c.outline);
  return r.success ? r.data : null;
}

/** Ids for slides and hashtags in canonical form; called on every save. */
export function normalizeDocument(raw: CarouselDocumentInput): CarouselDocument {
  const doc = parseOrThrow(carouselDocumentSchema, raw);
  const seen = new Set<string>();
  for (const s of doc.slides) {
    if (!s.id || seen.has(s.id)) s.id = newSlideId();
    seen.add(s.id);
  }
  doc.hashtags = [...new Set(doc.hashtags.map(normalizeHashtag).filter(Boolean))];
  return doc;
}

// ---- Create and parameters ----

export interface CreateCarouselInput {
  clientId: string;
  params: CarouselParamsInput;
  brief?: BriefInput;
}

/**
 * New carousel (page 40). Needs a published Brand Identity: generation only ever
 * uses approved brand elements. From a plan item, its theme, hook and notes seed the
 * brief (“From the plan”) and the item links to the carousel.
 */
export async function createCarousel(db: Database, actor: Actor, input: CreateCarouselInput) {
  humanOnly(actor, "edit_draft", input.clientId);
  const client = await requireClient(db, input.clientId);
  if (client.status === "archived" || client.archivedAt) conflict("content.errors.clientArchived");
  const brand = await getPublishedBrandIdentity(db, actor, input.clientId);
  if (!brand)
    conflict("content.errors.brandNotPublishedForCarousel", {
      code: "BRAND-NOT-PUBLISHED",
    });
  const params = parseOrThrow(carouselParamsSchema, input.params);
  const template = await getTemplate(db, input.clientId, params.templateKey);
  if (template.format !== params.format)
    invalid("content.errors.templateWrongFormat", undefined, { name: template.name });
  const audience = new Set(
    brand.document.strategy.audience.filter((a) => !a.deprecated).map((a) => a.id),
  );
  if (!params.audienceIds.every((a) => audience.has(a)))
    invalid("content.errors.audienceNotInBrand");

  const brief = parseOrThrow(briefSchema, input.brief ?? {});
  let title = params.title;
  let pillarId = params.pillarId;
  let rubricId = params.rubricId;
  let productId = params.productId;

  if (params.planItemId) {
    const [item] = await db
      .select({ item: contentPlanItems, planStatus: contentPlans.status })
      .from(contentPlanItems)
      .innerJoin(contentPlans, eq(contentPlans.id, contentPlanItems.planId))
      .where(
        and(
          eq(contentPlanItems.id, params.planItemId),
          eq(contentPlanItems.clientId, input.clientId),
        ),
      );
    if (!item) notFound("content.errors.planItemNotFound");
    if (item.item.status !== "accepted" || item.planStatus !== "active")
      conflict("content.errors.planItemNotUsable");
    if (item.item.contentId) conflict("content.errors.planItemHasCarousel");
    title ||= item.item.theme;
    pillarId ??= item.item.pillarId;
    rubricId ??= item.item.rubricId;
    productId ??= item.item.productIds[0] ?? null;
    if (!brief.text) {
      brief.text = [item.item.theme, item.item.hook, item.item.notes].filter(Boolean).join("\n");
      brief.fromPlan = [...new Set([...brief.fromPlan, "text" as const])];
    }
  }
  if (pillarId) {
    const [p] = await db
      .select({ id: contentPillars.id })
      .from(contentPillars)
      .where(
        and(
          eq(contentPillars.id, pillarId),
          eq(contentPillars.clientId, input.clientId),
          eq(contentPillars.status, "accepted"),
        ),
      );
    if (!p) invalid("content.errors.pillarNotActiveShort");
  }
  if (rubricId) {
    const [r] = await db
      .select({ pillarId: contentRubrics.pillarId })
      .from(contentRubrics)
      .where(
        and(
          eq(contentRubrics.id, rubricId),
          eq(contentRubrics.clientId, input.clientId),
          eq(contentRubrics.status, "accepted"),
        ),
      );
    if (!r) invalid("content.errors.rubricNotActive");
    pillarId ??= r.pillarId;
  }
  let productRevision: number | null = null;
  if (productId) {
    const product = await productSource().get(db, input.clientId, productId);
    if (!product) invalid("content.errors.productNotApproved");
    productRevision = product.revision;
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contents)
      .values({
        clientId: input.clientId,
        title: title || UNTITLED,
        objective: params.objective,
        audienceIds: params.audienceIds,
        pillarId,
        rubricId,
        planItemId: params.planItemId,
        productId,
        productRevision,
        channel: params.channel,
        format: params.format,
        templateKey: template.key,
        slideCount: clampSlideCount(template.manifest, params.slideCount),
        language: params.language,
        brandVersionId: brand.versionId,
        brief: brief as unknown as Record<string, unknown>,
        createdBy: actor.id,
      })
      .returning();
    if (params.planItemId)
      await tx
        .update(contentPlanItems)
        .set({ contentId: row!.id })
        .where(and(eq(contentPlanItems.id, params.planItemId), isNull(contentPlanItems.contentId)));
    await audit(tx, actor, "created", row!, {
      template: template.key,
      planItemId: params.planItemId,
    });
    return row!;
  });
}

/** Change parameters. Changing template or format of a carousel with slides needs `resetSlides`. */
export async function updateParams(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    id: string;
    briefRev: number;
    params: CarouselParamsInput;
    resetSlides?: boolean;
  },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (!EDITABLE.includes(c.status)) conflict("content.errors.notEditable");
  assertNotLocked(c);
  const p = parseOrThrow(carouselParamsSchema, input.params);
  const template = await getTemplate(db, input.clientId, p.templateKey);
  if (template.format !== p.format)
    invalid("content.errors.templateWrongFormat", undefined, { name: template.name });
  const doc = parseDocument(c.draft);
  const templateChanged = p.templateKey !== c.templateKey || p.format !== c.format;
  if (templateChanged && doc.slides.length && !input.resetSlides)
    conflict("content.errors.templateChangeResets", {
      code: "TEMPLATE-CHANGE-RESETS",
    });
  let productRevision = c.productRevision;
  if (p.productId !== c.productId) {
    productRevision = null;
    if (p.productId) {
      const product = await productSource().get(db, input.clientId, p.productId);
      if (!product) invalid("content.errors.productNotApproved");
      productRevision = product.revision;
    }
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(contents)
      .set({
        title: p.title || c.title,
        objective: p.objective,
        audienceIds: p.audienceIds,
        pillarId: p.pillarId,
        rubricId: p.rubricId,
        productId: p.productId,
        productRevision,
        channel: p.channel,
        format: p.format,
        templateKey: template.key,
        slideCount: clampSlideCount(template.manifest, p.slideCount),
        language: p.language,
        briefRev: sql`${contents.briefRev} + 1`,
        ...(templateChanged
          ? { templateVersion: null, draft: null, draftRev: sql`${contents.draftRev} + 1` }
          : {}),
      })
      .where(and(eq(contents.id, c.id), eq(contents.briefRev, input.briefRev)))
      .returning();
    if (!row) revConflict({ briefRev: c.briefRev });
    await audit(tx, actor, "params_updated", c, { templateChanged });
    return row;
  });
}

export async function saveBrief(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; briefRev: number; brief: BriefInput },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (!EDITABLE.includes(c.status)) conflict("content.errors.notEditable");
  const brief = parseOrThrow(briefSchema, input.brief);
  const [row] = await db
    .update(contents)
    .set({
      brief: brief as unknown as Record<string, unknown>,
      briefRev: sql`${contents.briefRev} + 1`,
    })
    .where(and(eq(contents.id, c.id), eq(contents.briefRev, input.briefRev)))
    .returning({ briefRev: contents.briefRev });
  if (!row) revConflict({ briefRev: c.briefRev });
  return row;
}

/** The outline may start once the brief text has at least 20 characters. */
export function briefReady(brief: unknown): boolean {
  const b = briefSchema.safeParse(brief ?? {});
  return b.success && b.data.text.trim().length >= BRIEF_MIN_CHARS;
}

// ---- Outline ----

/** Store an outline (person or Copywriter) as the next number and make it current. */
export async function recordOutline(
  db: Executor,
  input: {
    content: ContentRow;
    outline: Outline;
    origin: "ai" | "manual" | "restore";
    actor: Actor;
    instruction?: string | null;
    jobId?: string | null;
  },
) {
  const c = input.content;
  const number = c.outlineNumber + 1;
  await db.insert(contentOutlines).values({
    contentId: c.id,
    number,
    outline: input.outline as unknown as Record<string, unknown>,
    origin: input.origin,
    instruction: input.instruction ?? null,
    jobId: input.jobId ?? null,
    createdBy: input.actor.type === "user" ? input.actor.id : null,
  });
  const [row] = await db
    .update(contents)
    .set({
      outline: input.outline as unknown as Record<string, unknown>,
      outlineNumber: number,
      outlineBriefRev: c.briefRev,
      // A new outline needs a new approval before slides.
      outlineApprovedBy: null,
      outlineApprovedAt: null,
      ...(input.outline.title && UNTITLED_TITLES.includes(c.title)
        ? { title: input.outline.title }
        : {}),
    })
    .where(and(eq(contents.id, c.id), eq(contents.outlineNumber, c.outlineNumber)))
    .returning();
  if (!row) revConflict({ outlineNumber: c.outlineNumber });
  return row;
}

export async function saveOutline(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; outlineNumber: number; outline: OutlineInput },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (!EDITABLE.includes(c.status)) conflict("content.errors.notEditable");
  assertNotLocked(c);
  if (c.outlineNumber !== input.outlineNumber) revConflict({ outlineNumber: c.outlineNumber });
  const outline = parseOrThrow(outlineSchema, input.outline);
  return db.transaction(async (tx) => {
    const row = await recordOutline(tx, { content: c, outline, origin: "manual", actor });
    await audit(tx, actor, "outline_saved", c, { number: row.outlineNumber });
    return row;
  });
}

export async function restoreOutline(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; number: number },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  assertNotLocked(c);
  const [old] = await db
    .select()
    .from(contentOutlines)
    .where(and(eq(contentOutlines.contentId, c.id), eq(contentOutlines.number, input.number)));
  if (!old) notFound("content.errors.outlineNotFound");
  const outline = parseOrThrow(outlineSchema, old.outline);
  return db.transaction(async (tx) => {
    const row = await recordOutline(tx, { content: c, outline, origin: "restore", actor });
    await audit(tx, actor, "outline_restored", c, { from: input.number });
    return row;
  });
}

/** “Approve outline”: required before the Copywriter writes the slides. */
export async function approveOutline(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; outlineNumber: number },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (!outlineOf(c)) invalid("content.errors.noOutline");
  const [row] = await db
    .update(contents)
    .set({ outlineApprovedBy: actor.id, outlineApprovedAt: new Date() })
    .where(and(eq(contents.id, c.id), eq(contents.outlineNumber, input.outlineNumber)))
    .returning();
  if (!row) revConflict({ outlineNumber: c.outlineNumber });
  await audit(db, actor, "outline_approved", c, { number: input.outlineNumber });
  return row;
}

// ---- Draft and versions ----

async function nextVersionNumber(db: Executor, contentId: string) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(max(${contentVersions.number}), 0)::int` })
    .from(contentVersions)
    .where(eq(contentVersions.contentId, contentId));
  return (r?.n ?? 0) + 1;
}

/** Immutable snapshot of the document; becomes the current version. */
export async function createVersion(
  db: Executor,
  input: {
    content: ContentRow;
    document: CarouselDocument;
    origin: "ai" | "manual" | "restore" | "submit";
    actor: Actor;
    meta?: Record<string, unknown>;
  },
) {
  const c = input.content;
  const [v] = await db
    .insert(contentVersions)
    .values({
      contentId: c.id,
      number: await nextVersionNumber(db, c.id),
      document: input.document as unknown as Record<string, unknown>,
      caption: input.document.caption,
      hashtags: input.document.hashtags,
      createdFrom: input.origin,
      meta: {
        templateKey: c.templateKey,
        templateVersion: c.templateVersion,
        brandVersionId: c.brandVersionId,
        ...input.meta,
      },
      brandVersionId: c.brandVersionId,
      createdBy: input.actor.type === "user" ? input.actor.id : null,
    })
    .returning();
  await db.update(contents).set({ currentVersionId: v!.id }).where(eq(contents.id, c.id));
  return v!;
}

/**
 * Autosave of the editor (draft_rev). Editing an approved or exported carousel
 * sends it back to draft: it must be approved again before a final export.
 */
export async function saveDraft(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; draftRev: number; document: CarouselDocumentInput },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (c.status === "in_review")
    conflict("content.errors.inReview", {
      code: "CONTENT-IN-REVIEW",
    });
  if (!EDITABLE.includes(c.status)) conflict("content.errors.notEditable");
  assertNotLocked(c);
  const doc = normalizeDocument(input.document);
  const status = c.status === "changes_requested" ? c.status : nextStatus(actor, c, "draft");
  const [row] = await db
    .update(contents)
    .set({
      draft: doc as unknown as Record<string, unknown>,
      draftRev: sql`${contents.draftRev} + 1`,
      draftUpdatedBy: actor.id,
      draftUpdatedAt: new Date(),
      status,
      ...(doc.title ? { title: doc.title } : {}),
    })
    .where(and(eq(contents.id, c.id), eq(contents.draftRev, input.draftRev)))
    .returning({ draftRev: contents.draftRev, status: contents.status });
  if (!row)
    revConflict({
      draftRev: c.draftRev,
      updatedBy: c.draftUpdatedBy,
      updatedAt: c.draftUpdatedAt?.toISOString() ?? null,
    });
  if (status !== c.status) await audit(db, actor, "reopened", c, { from: c.status });
  if (brandGuard())
    await checkDocument(db, actor, { ...c, status: row.status }, doc, {
      guard: "run",
      version: null,
    });
  return row;
}

/** “Save version”: named checkpoint of the current draft. */
export async function saveVersion(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; draftRev: number; note?: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (c.draftRev !== input.draftRev) revConflict({ draftRev: c.draftRev });
  const doc = parseDocument(c.draft);
  if (!doc.slides.length) invalid("content.errors.noSlides");
  return db.transaction(async (tx) => {
    const v = await createVersion(tx, {
      content: c,
      document: doc,
      origin: "manual",
      actor,
      meta: input.note ? { note: input.note.slice(0, 300) } : {},
    });
    await audit(tx, actor, "version_saved", c, { number: v.number });
    return v;
  });
}

/** Restore an old version into the draft; recorded as a new version (history is never rewritten). */
export async function restoreVersion(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; number: number },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (c.status === "in_review") conflict("content.errors.withdrawBeforeRestore");
  assertNotLocked(c);
  const [old] = await db
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.contentId, c.id), eq(contentVersions.number, input.number)));
  if (!old) notFound("content.errors.versionNotFound");
  const doc = parseDocument(old.document);
  const status = c.status === "changes_requested" ? c.status : nextStatus(actor, c, "draft");
  return db.transaction(async (tx) => {
    await tx
      .update(contents)
      .set({
        draft: doc as unknown as Record<string, unknown>,
        draftRev: sql`${contents.draftRev} + 1`,
        draftUpdatedBy: actor.id,
        draftUpdatedAt: new Date(),
        status,
      })
      .where(eq(contents.id, c.id));
    const v = await createVersion(tx, {
      content: c,
      document: doc,
      origin: "restore",
      actor,
      meta: { restoredFrom: input.number },
    });
    await audit(tx, actor, "version_restored", c, { from: input.number, number: v.number });
    return v;
  });
}

const sameDocument = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The current version if it matches the draft, else a new `manual` one. */
export async function ensureCurrentVersion(db: Executor, actor: Actor, c: ContentRow) {
  const doc = parseDocument(c.draft);
  if (!doc.slides.length) invalid("content.errors.noSlides");
  if (c.currentVersionId) {
    const [cur] = await db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.id, c.currentVersionId));
    if (cur && sameDocument(parseDocument(cur.document), doc)) return cur;
  }
  return createVersion(db, { content: c, document: doc, origin: "manual", actor });
}

// ---- Slide edits from the AI ----

/** “Undo edit” on an AI slide edit: put the slide back if nobody changed it since. */
export async function decideSlideEdit(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; editId: string; decision: "keep" | "revert" },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  assertNotLocked(c);
  const [edit] = await db
    .select()
    .from(contentSlideEdits)
    .where(and(eq(contentSlideEdits.id, input.editId), eq(contentSlideEdits.contentId, c.id)));
  if (!edit) notFound("content.errors.editNotFound");
  if (edit.status !== "applied") conflict("content.errors.editDecided");
  return db.transaction(async (tx) => {
    if (input.decision === "revert") {
      const doc = parseDocument(c.draft);
      const i = doc.slides.findIndex((s) => s.id === edit.slideId);
      if (i < 0) conflict("content.errors.slideGone");
      if (!sameDocument(doc.slides[i], edit.after))
        conflict("content.errors.slideChangedAfterEdit");
      doc.slides[i] = contentSlideSchema.parse(edit.before);
      await tx
        .update(contents)
        .set({
          draft: doc as unknown as Record<string, unknown>,
          draftRev: sql`${contents.draftRev} + 1`,
          draftUpdatedBy: actor.id,
          draftUpdatedAt: new Date(),
        })
        .where(eq(contents.id, c.id));
    }
    await tx
      .update(contentSlideEdits)
      .set({ status: input.decision === "keep" ? "kept" : "reverted" })
      .where(eq(contentSlideEdits.id, edit.id));
    await audit(tx, actor, `slide_edit_${input.decision === "keep" ? "kept" : "reverted"}`, c, {
      slideId: edit.slideId,
    });
    return { ok: true as const };
  });
}

// ---- Checks ----

export interface ContentChecks {
  checks: ContentCheck[];
  errors: ContentCheck[];
  warnings: ContentCheck[];
  /** Latest Brand Guard report, when the guard is registered and has run. */
  guard: GuardReport | null;
}

async function libraryInfo(db: Executor, clientId: string, keys: string[]) {
  const map = new Map<string, AssetInfo>();
  const guard = new Map<string, GuardAssetInfo>();
  if (!keys.length) return { map, guard };
  const rows = await db
    .select({
      id: assets.id,
      storageKey: assets.storageKey,
      status: assets.status,
      source: assets.source,
      alt: assets.alt,
      width: assets.width,
      height: assets.height,
      generation: assets.generation,
    })
    .from(assets)
    .where(and(eq(assets.clientId, clientId), inArray(assets.storageKey, keys)));
  for (const r of rows) {
    map.set(r.storageKey, {
      status: r.status,
      source: r.source,
      alt: r.alt,
      commercialUsePending:
        r.source === "ai" &&
        (r.generation as { commercialUse?: string } | null)?.commercialUse !== "verified",
    });
    guard.set(r.storageKey, {
      id: r.id,
      source: r.source,
      status: r.status,
      width: r.width,
      height: r.height,
    });
  }
  return { map, guard };
}

export function imageKeys(doc: CarouselDocument): string[] {
  const keys = new Set<string>();
  for (const s of doc.slides)
    for (const v of Object.values(s.slots))
      if (v && typeof v === "object" && !Array.isArray(v) && v.key) keys.add(v.key);
  return [...keys];
}

/**
 * Checks of a document of this carousel, with the brand and library data they need.
 * With the Brand Guard registered, `guard: "run"` checks the document again (on save
 * and on submit) and `"read"` returns its latest report; the brand rules it owns are
 * then left to it. A guard failure never stops the editor: the module's own checks stay.
 */
export async function checkDocument(
  db: Database,
  actor: Actor,
  c: ContentRow,
  doc: CarouselDocument,
  options: { guard?: "run" | "read" | "none"; version?: number | null } = {},
): Promise<ContentChecks> {
  const [template, brand, library, product] = await Promise.all([
    getTemplate(db, c.clientId, c.templateKey, c.templateVersion).catch(() => null),
    getPublishedBrandIdentity(db, actor, c.clientId),
    libraryInfo(db, c.clientId, imageKeys(doc)),
    c.productId ? productSource().get(db, c.clientId, c.productId) : Promise.resolve(null),
  ]);
  const brief = briefSchema.parse(c.brief ?? {});
  let checks = computeChecks({
    document: doc,
    manifest: template?.manifest ?? null,
    channel: c.channel as ContentChannel,
    forbiddenWords: brand?.document.verbal.forbiddenWords ?? [],
    ...(brand?.document.verbal.writingRules?.value.maxHashtags !== undefined
      ? { maxHashtags: brand.document.verbal.writingRules.value.maxHashtags }
      : {}),
    assets: library.map,
    usePrice: brief.usePrice,
    wantsAltText: brief.outputs.altText,
    productRevision: c.productId
      ? { used: c.productRevision, current: product?.revision ?? null }
      : null,
    brandVersion: { used: c.brandVersionId, current: brand?.versionId ?? null },
  });

  const port = brandGuard();
  let guard: GuardReport | null = null;
  if (port && options.guard !== "none") {
    const subject = carouselSubject(c.id, options.version);
    try {
      if (options.guard === "run" && doc.slides.length) {
        const content = toGuardContent({
          document: doc,
          manifest: template?.manifest ?? null,
          channel: c.channel as ContentChannel,
          assets: library.guard,
          product,
          asksPrice: brief.usePrice,
        });
        guard = (
          await port.run(db, actor, {
            clientId: c.clientId,
            subject,
            content,
            ...(c.brandVersionId ? { brandVersionId: c.brandVersionId } : {}),
          })
        ).report;
      } else {
        guard = (await port.get(db, actor, { clientId: c.clientId, subject }))?.report ?? null;
      }
    } catch {
      guard = null;
    }
    if (guard)
      checks = checks.filter((x) => !GUARDED_CHECK_PREFIXES.some((p) => x.id.startsWith(p)));
  }
  return { checks, errors: blockingChecks(checks), warnings: warningChecks(checks), guard };
}

// ---- Review and approval ----

/** “Send for review”: blocking checks must pass; the submitted draft becomes a version. */
export async function submitForReview(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; draftRev: number; reviewerId?: string | null },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  assertNotLocked(c);
  if (c.draftRev !== input.draftRev) revConflict({ draftRev: c.draftRev });
  if (c.status === "changes_requested") c.status = nextStatus(actor, c, "draft");
  nextStatus(actor, c, "in_review");
  const doc = parseDocument(c.draft);
  const { errors } = await checkDocument(db, actor, c, doc, { guard: "none" });
  if (errors.length)
    throw localizedError("validation", "content.errors.fixBeforeSending", undefined, {
      code: "CHECKS-BLOCKING",
      checks: errors,
    });
  const result = await db.transaction(async (tx) => {
    const v = await createVersion(tx, { content: c, document: doc, origin: "submit", actor });
    const [row] = await tx
      .update(contents)
      .set({
        status: "in_review",
        submittedBy: actor.id,
        reviewerId: input.reviewerId ?? null,
        reviewNote: null,
      })
      .where(and(eq(contents.id, c.id), eq(contents.draftRev, input.draftRev)))
      .returning();
    if (!row) revConflict({ draftRev: c.draftRev });
    await audit(tx, actor, "submitted", c, {
      version: v.number,
      reviewerId: input.reviewerId ?? null,
    });
    return { content: row, version: v };
  });
  if (brandGuard())
    await checkDocument(db, actor, result.content, doc, {
      guard: "run",
      version: result.version.number,
    });
  return result;
}

export async function withdrawFromReview(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (c.status !== "in_review") conflict("content.errors.notInReview");
  const to = nextStatus(actor, c, "draft");
  await db.update(contents).set({ status: to }).where(eq(contents.id, c.id));
  await audit(db, actor, "withdrawn", c);
  return { ok: true as const };
}

/**
 * Approve or request changes on the version under review (page 47). Approval needs
 * “Seen” on every warning and no blocking problem (AI images approved first);
 * approving your own work needs a note. Only people: `approve` is never an agent's.
 */
export async function decideReview(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    id: string;
    versionId: string;
    decision: "approved" | "changes_requested";
    note?: string;
    acknowledged?: string[];
  },
) {
  humanOnly(actor, input.decision === "approved" ? "approve" : "review", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (c.status !== "in_review") conflict("content.errors.notInReview");
  if (c.currentVersionId !== input.versionId)
    conflict("content.errors.versionChanged", {
      code: "VERSION-CHANGED",
    });
  const note = input.note?.trim().slice(0, 2000) ?? "";
  const selfApproval = c.submittedBy === actor.id || (!c.submittedBy && c.createdBy === actor.id);
  const [version] = await db
    .select()
    .from(contentVersions)
    .where(eq(contentVersions.id, input.versionId));
  if (!version) notFound("content.errors.versionNotFound");
  const acknowledged = [...new Set(input.acknowledged ?? [])];

  if (input.decision === "changes_requested") {
    if (note.length < 3) invalid("content.errors.changesNoteRequired");
  } else {
    // The guard's report must be about this very version: check it again if not.
    const guardPort = brandGuard();
    const latest = guardPort
      ? await guardPort
          .get(db, actor, { clientId: c.clientId, subject: carouselSubject(c.id, version.number) })
          .catch(() => null)
      : null;
    const { errors, warnings } = await checkDocument(
      db,
      actor,
      c,
      parseDocument(version.document),
      {
        guard: guardPort && latest?.subjectVersion !== version.number ? "run" : "read",
        version: version.number,
      },
    );
    if (errors.length)
      throw localizedError("validation", "content.errors.blockingProblems", undefined, {
        code: "CHECKS-BLOCKING",
        checks: errors,
      });
    const missing = warnings.filter((w) => !acknowledged.includes(w.id));
    if (missing.length)
      throw localizedError("validation", "content.errors.confirmSeen", undefined, {
        code: "CHECKS-UNACKNOWLEDGED",
        checks: missing,
      });
    if (selfApproval && note.length < 3)
      invalid("content.errors.selfApprovalNote", {
        code: "SELF-APPROVAL-NOTE",
      });
  }
  const to = nextStatus(actor, c, input.decision);
  const port = brandGuard();
  return db.transaction(async (tx) => {
    // “Seen” on every open guard error and warning; AI images not approved block.
    if (port && input.decision === "approved")
      await port.confirmForApproval(tx, actor, {
        clientId: c.clientId,
        subject: { ...carouselSubject(c.id), version: version.number },
        acknowledgedKeys: acknowledged,
      });
    await tx.insert(contentApprovals).values({
      contentId: c.id,
      versionId: version.id,
      decision: input.decision,
      note: note || null,
      selfApproval: input.decision === "approved" && selfApproval,
      acknowledged,
      decidedBy: actor.id,
    });
    const [row] = await tx
      .update(contents)
      .set({
        status: to,
        reviewNote: note || null,
        ...(input.decision === "approved" ? { approvedVersionId: version.id } : {}),
      })
      .where(and(eq(contents.id, c.id), eq(contents.status, "in_review")))
      .returning();
    if (!row) conflict("content.errors.changedMeanwhile");
    await audit(tx, actor, input.decision, c, { version: version.number, selfApproval });
    return row;
  });
}

export async function setContentArchived(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; archived: boolean },
) {
  humanOnly(actor, "archive", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  assertNotLocked(c);
  const to = nextStatus(actor, c, input.archived ? "archived" : "draft");
  await db
    .update(contents)
    .set({ status: to, archivedAt: input.archived ? new Date() : null })
    .where(eq(contents.id, c.id));
  await audit(db, actor, input.archived ? "archived" : "restored", c);
  return { ok: true as const };
}

// ---- Comments ----

export async function addComment(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; body: string; slideId?: string | null },
) {
  humanOnly(actor, "review", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  const body = input.body.trim();
  if (body.length < 1 || body.length > 2000) invalid("content.errors.commentLength");
  const [row] = await db
    .insert(contentComments)
    .values({
      contentId: c.id,
      versionId: c.currentVersionId,
      slideId: input.slideId?.slice(0, 64) ?? null,
      body,
      authorId: actor.id,
    })
    .returning();
  return row!;
}

export async function resolveComment(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; commentId: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  const [row] = await db
    .update(contentComments)
    .set({ resolvedBy: actor.id, resolvedAt: new Date() })
    .where(
      and(
        eq(contentComments.id, input.commentId),
        eq(contentComments.contentId, c.id),
        isNull(contentComments.resolvedAt),
      ),
    )
    .returning({ id: contentComments.id });
  if (!row) notFound("content.errors.commentNotFound");
  return row;
}

// ---- Exports ----

/**
 * Which version an export uses: a final export takes the approved version and
 * needs status approved or exported; a draft export (“Draft” watermark) takes the
 * current draft, saved as a version if it changed.
 */
export async function prepareExport(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; draft: boolean },
) {
  humanOnly(actor, input.draft ? "edit_draft" : "reports.export", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (!input.draft) {
    if (c.status !== "approved" && c.status !== "exported")
      conflict("content.errors.exportNotApproved", {
        code: "EXPORT-NOT-APPROVED",
      });
    if (!c.approvedVersionId) conflict("content.errors.approvedVersionMissing");
    const [v] = await db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.id, c.approvedVersionId));
    if (!v) notFound("content.errors.approvedVersionNotFound");
    return { content: c, version: v };
  }
  assertNotLocked(c);
  const v = await db.transaction((tx) => ensureCurrentVersion(tx, actor, c));
  return { content: c, version: v };
}

/** Called by the export job when the files are ready; the first final export marks it exported. */
export async function recordExport(
  db: Database,
  input: {
    contentId: string;
    versionId: string;
    jobId: string;
    draft: boolean;
    outputs: string[];
    files: Record<string, unknown>[];
    requestedBy: string | null;
  },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contentExports)
      .values({
        contentId: input.contentId,
        versionId: input.versionId,
        jobId: input.jobId,
        draft: input.draft,
        outputs: input.outputs,
        files: input.files,
        createdBy: input.requestedBy,
      })
      .returning();
    if (!input.draft) {
      const [c] = await tx
        .update(contents)
        .set({ status: "exported" })
        .where(
          and(
            eq(contents.id, input.contentId),
            eq(contents.status, "approved"),
            eq(contents.approvedVersionId, input.versionId),
          ),
        )
        .returning({ id: contents.id, clientId: contents.clientId });
      if (c) await audit(tx, "system", "exported", c, { versionId: input.versionId });
    }
    return row!;
  });
}

export async function listExports(db: Database, contentId: string) {
  return db
    .select()
    .from(contentExports)
    .where(eq(contentExports.contentId, contentId))
    .orderBy(desc(contentExports.createdAt))
    .limit(50);
}
