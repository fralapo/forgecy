/**
 * Channel adaptation (ADR 0025): an Instagram carousel in review or approved is proposed for
 * LinkedIn or Facebook by the `content.adapt_channel` job. The proposal lives in that job's
 * result (no table); a person accepts it, which creates a NEW draft content for the channel,
 * or dismisses it. Nothing here approves or changes the source, and the new draft still goes
 * through the checks, the review and the approval like any other.
 */
import { findLayout, type TemplateManifest } from "@forgecy/carousel";
import type { Actor } from "@forgecy/core";
import { and, desc, eq, jobs, recordAuditEvent, sql, type Database } from "@forgecy/db";
import { conflict, humanOnly, invalid, notFound } from "../access";
import {
  adaptDecisionSchema,
  adaptProposalSchema,
  briefSchema,
  channelFormat,
  newSlideId,
  normalizeHashtag,
  type AdaptDecision,
  type AdaptProposal,
  type CarouselDocument,
  type CarouselParamsInput,
  type ContentSlide,
} from "../document";
import { createCarousel, getContentRow, saveDraft, type ContentRow } from "./carousels";
import { clampSlots, getTemplate } from "./templates";

const KIND = "content.adapt_channel";

export interface AdaptationView {
  jobId: string;
  proposal: AdaptProposal;
  /** Null while the proposal waits for a person. */
  decision: AdaptDecision | null;
}

function viewOf(row: {
  id: string;
  result: Record<string, unknown> | null;
}): AdaptationView | null {
  const proposal = adaptProposalSchema.safeParse(row.result?.proposal);
  if (!proposal.success) return null;
  const decision = adaptDecisionSchema.safeParse(row.result?.decision);
  return {
    jobId: row.id,
    proposal: proposal.data,
    decision: decision.success ? decision.data : null,
  };
}

/** The latest finished proposal of each channel for a content. */
export async function latestAdaptations(
  db: Database,
  contentId: string,
): Promise<AdaptationView[]> {
  const rows = await db
    .select({ id: jobs.id, result: jobs.result })
    .from(jobs)
    .where(
      and(
        eq(jobs.entity, "content"),
        eq(jobs.entityId, contentId),
        eq(jobs.kind, KIND),
        eq(jobs.status, "completed"),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(20);
  const seen = new Set<string>();
  const out: AdaptationView[] = [];
  for (const r of rows) {
    const v = viewOf(r);
    if (!v || seen.has(v.proposal.channel)) continue;
    seen.add(v.proposal.channel);
    out.push(v);
  }
  return out;
}

/** The new channel's document: only layouts of the template, slots cut to them, plain text. */
export function adaptedDocument(
  proposal: AdaptProposal,
  manifest: TemplateManifest,
  title: string,
): CarouselDocument {
  const slides: ContentSlide[] = [];
  for (const s of proposal.slides) {
    const layout = findLayout(manifest, s.layout);
    if (!layout) continue;
    const slots = clampSlots(layout, s.slots);
    if (!Object.keys(slots).length) continue;
    slides.push({
      id: newSlideId(),
      layout: layout.id,
      tone: "default",
      role: layout.role,
      slots,
      protectedSlots: [],
    });
  }
  return {
    title,
    slides,
    caption: proposal.caption,
    hashtags: [...new Set(proposal.hashtags.map(normalizeHashtag).filter(Boolean))],
  };
}

/** Takes the proposal's single answer: false when someone answered it first. */
async function claim(
  db: Database,
  job: { id: string; result: Record<string, unknown> | null },
  decision: AdaptDecision,
) {
  const rows = await db
    .update(jobs)
    .set({ result: { ...job.result, decision } })
    .where(and(eq(jobs.id, job.id), sql`${jobs.result}->'decision' is null`))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

async function loadProposal(db: Database, clientId: string, jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) notFound("content.errors.adaptationNotFound");
  const [row] = await db
    .select({ id: jobs.id, result: jobs.result, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.clientId, clientId), eq(jobs.kind, KIND)));
  const view = row && row.status === "completed" ? viewOf(row) : null;
  if (!row || !view) notFound("content.errors.adaptationNotFound");
  if (view.decision) conflict("content.errors.adaptationDecided");
  return { job: row, view };
}

/**
 * “Accept”: creates a new DRAFT content for the channel from the proposal (client, pillar,
 * rubric, product, audience and language of the source; the client's published Brand Identity
 * at this moment) and answers the proposal. A person only; the new draft is checked, reviewed
 * and approved like any other.
 */
export async function acceptAdaptation(
  db: Database,
  actor: Actor,
  input: { clientId: string; jobId: string },
): Promise<ContentRow> {
  humanOnly(actor, "edit_draft", input.clientId);
  const { job, view } = await loadProposal(db, input.clientId, input.jobId);
  const p = view.proposal;
  if (!p.creditableAngle || !p.slides.length) invalid("content.errors.adaptationNothing");
  const source = await getContentRow(db, input.clientId, p.sourceContentId);
  const template = await getTemplate(db, input.clientId, p.templateKey);
  const document = adaptedDocument(p, template.manifest, source.title);
  if (!document.slides.length) invalid("content.errors.adaptationNothing");
  const at = new Date().toISOString();
  if (!(await claim(db, job, { status: "accepted", contentId: null, by: actor.id, at })))
    conflict("content.errors.adaptationDecided");
  try {
    const brief = briefSchema.parse(source.brief ?? {});
    const created = await createCarousel(db, actor, {
      clientId: input.clientId,
      params: {
        title: source.title,
        objective: source.objective,
        audienceIds: source.audienceIds,
        pillarId: source.pillarId,
        rubricId: source.rubricId,
        productId: source.productId,
        channel: p.channel,
        format: channelFormat[p.channel],
        templateKey: template.key,
        slideCount: document.slides.length,
        language: source.language as CarouselParamsInput["language"],
        planItemId: null,
      },
      brief: {
        ...brief,
        text: p.angle || brief.text,
        fromPlan: [],
        outputs: { ...brief.outputs, hashtags: Math.min(10, document.hashtags.length) },
      },
    });
    await saveDraft(db, actor, {
      clientId: input.clientId,
      id: created.id,
      draftRev: created.draftRev,
      document,
    });
    await db
      .update(jobs)
      .set({
        result: {
          ...job.result,
          decision: { status: "accepted", contentId: created.id, by: actor.id, at },
        },
      })
      .where(eq(jobs.id, job.id));
    await recordAuditEvent(db, {
      actor,
      action: "content.adaptation_accepted",
      entity: "content",
      entityId: created.id,
      clientId: input.clientId,
      meta: { sourceContentId: source.id, channel: p.channel, jobId: job.id },
    });
    return created;
  } catch (err) {
    // Nothing was created: the proposal waits again.
    await db.update(jobs).set({ result: job.result }).where(eq(jobs.id, job.id));
    throw err;
  }
}

/** “Dismiss”: the proposal is answered with no content created. A person only. */
export async function dismissAdaptation(
  db: Database,
  actor: Actor,
  input: { clientId: string; jobId: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const { job, view } = await loadProposal(db, input.clientId, input.jobId);
  const at = new Date().toISOString();
  if (!(await claim(db, job, { status: "dismissed", contentId: null, by: actor.id, at })))
    conflict("content.errors.adaptationDecided");
  await recordAuditEvent(db, {
    actor,
    action: "content.adaptation_dismissed",
    entity: "content",
    entityId: view.proposal.sourceContentId,
    clientId: input.clientId,
    meta: { channel: view.proposal.channel, jobId: job.id },
  });
}
