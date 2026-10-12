/**
 * Creative direction of a carousel (spec page 54, Creative Director AI): one concept,
 * the thread that ties the slides together and what each slide should do and show.
 * The agent proposes it; a person accepts or rejects it. Once accepted it guides the
 * Copywriter (outline, slides) and the Art Director (image prompts) of that carousel.
 */
import type { Actor } from "@forgecy/core";
import {
  and,
  contentCreativeDirections,
  desc,
  eq,
  recordAuditEvent,
  type Database,
} from "@forgecy/db";
import { z } from "zod";
import { conflict, humanOnly, invalid, notFound, parseOrThrow, type Executor } from "../access";
import { getContentRow } from "./carousels";

export const DIRECTION_SLIDES_MAX = 20;

export const creativeDirectionSchema = z.object({
  /** The idea in one or two sentences. */
  concept: z.string().trim().min(1).max(300),
  /** What carries the reader from the cover to the CTA. */
  thread: z.string().trim().max(400).default(""),
  /** Tone and rhythm within the Brand Identity's limits. */
  tone: z.string().trim().max(200).default(""),
  slides: z
    .array(
      z.object({
        position: z.number().int().min(1).max(DIRECTION_SLIDES_MAX),
        intent: z.string().trim().max(200),
        visual: z.string().trim().max(200).default(""),
      }),
    )
    .max(DIRECTION_SLIDES_MAX)
    .default([]),
});
export type CreativeDirection = z.output<typeof creativeDirectionSchema>;

export const directionProvenanceSchema = z.object({
  agent: z.literal("creative_director"),
  jobId: z.string().max(64).optional(),
  provider: z.string().max(40).optional(),
  model: z.string().max(120).optional(),
  rationale: z.string().max(1000).default(""),
});
export type DirectionProvenance = z.infer<typeof directionProvenanceSchema>;

export type DirectionRow = typeof contentCreativeDirections.$inferSelect;

export interface DirectionView extends Omit<DirectionRow, "direction" | "provenance"> {
  direction: CreativeDirection;
  provenance: DirectionProvenance | null;
}

function view(row: DirectionRow): DirectionView {
  const direction = creativeDirectionSchema.safeParse(row.direction);
  const provenance = directionProvenanceSchema.safeParse(row.provenance);
  return {
    ...row,
    direction: direction.success
      ? direction.data
      : { concept: "", thread: "", tone: "", slides: [] },
    provenance: provenance.success ? provenance.data : null,
  };
}

/** Every direction of a carousel, newest first. Reading needs `view` on the client. */
export async function listDirections(
  db: Database,
  clientId: string,
  contentId: string,
): Promise<DirectionView[]> {
  const c = await getContentRow(db, clientId, contentId);
  const rows = await db
    .select()
    .from(contentCreativeDirections)
    .where(eq(contentCreativeDirections.contentId, c.id))
    .orderBy(desc(contentCreativeDirections.number));
  return rows.map(view);
}

/** The direction a person accepted last, which the other agents follow. */
export async function acceptedDirection(
  db: Executor,
  contentId: string,
): Promise<CreativeDirection | null> {
  const [row] = await db
    .select()
    .from(contentCreativeDirections)
    .where(
      and(
        eq(contentCreativeDirections.contentId, contentId),
        eq(contentCreativeDirections.status, "accepted"),
      ),
    )
    .orderBy(desc(contentCreativeDirections.decidedAt))
    .limit(1);
  return row ? view(row).direction : null;
}

/**
 * Stores a proposal of the Creative Director. Earlier open proposals become stale:
 * only the newest one waits for a decision.
 */
export async function recordDirection(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    contentId: string;
    direction: CreativeDirection;
    provenance: DirectionProvenance;
    instruction?: string | null;
    jobId?: string | null;
  },
) {
  if (actor.type !== "agent" || actor.role !== "creative_director")
    invalid("content.errors.invalidData");
  const direction = parseOrThrow(creativeDirectionSchema, input.direction);
  const provenance = directionProvenanceSchema.parse(input.provenance);
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ number: contentCreativeDirections.number })
      .from(contentCreativeDirections)
      .where(eq(contentCreativeDirections.contentId, input.contentId))
      .orderBy(desc(contentCreativeDirections.number))
      .limit(1);
    await tx
      .update(contentCreativeDirections)
      .set({ status: "stale" })
      .where(
        and(
          eq(contentCreativeDirections.contentId, input.contentId),
          eq(contentCreativeDirections.status, "proposed"),
        ),
      );
    const [row] = await tx
      .insert(contentCreativeDirections)
      .values({
        contentId: input.contentId,
        number: (last?.number ?? 0) + 1,
        direction: direction as unknown as Record<string, unknown>,
        provenance: provenance as unknown as Record<string, unknown>,
        instruction: input.instruction || null,
        jobId: input.jobId ?? null,
      })
      .returning();
    await recordAuditEvent(tx, {
      actor,
      action: "content.direction_proposed",
      entity: "content",
      entityId: input.contentId,
      clientId: input.clientId,
      meta: { number: row!.number },
    });
    return row!;
  });
}

async function openDirection(db: Database, clientId: string, contentId: string, id: string) {
  const c = await getContentRow(db, clientId, contentId);
  const [row] = await db
    .select()
    .from(contentCreativeDirections)
    .where(
      and(eq(contentCreativeDirections.id, id), eq(contentCreativeDirections.contentId, c.id)),
    );
  if (!row) notFound("content.errors.proposalNotFound");
  if (row.status !== "proposed") conflict("content.errors.proposalDecided");
  return { c, row };
}

/** A person accepts the proposal: it replaces the direction accepted before. */
export async function acceptDirection(
  db: Database,
  actor: Actor,
  input: { clientId: string; contentId: string; id: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const { c, row } = await openDirection(db, input.clientId, input.contentId, input.id);
  return db.transaction(async (tx) => {
    await tx
      .update(contentCreativeDirections)
      .set({ status: "stale" })
      .where(
        and(
          eq(contentCreativeDirections.contentId, c.id),
          eq(contentCreativeDirections.status, "accepted"),
        ),
      );
    const [updated] = await tx
      .update(contentCreativeDirections)
      .set({ status: "accepted", decidedBy: actor.id, decidedAt: new Date() })
      .where(
        and(
          eq(contentCreativeDirections.id, row.id),
          eq(contentCreativeDirections.status, "proposed"),
        ),
      )
      .returning();
    if (!updated) conflict("content.errors.proposalDecided");
    await recordAuditEvent(tx, {
      actor,
      action: "content.direction_accepted",
      entity: "content",
      entityId: c.id,
      clientId: c.clientId,
      meta: { number: row.number },
    });
    return updated;
  });
}

/** A person rejects the proposal, always saying why (the agent learns nothing silently). */
export async function rejectDirection(
  db: Database,
  actor: Actor,
  input: { clientId: string; contentId: string; id: string; reason: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const reason = input.reason.trim();
  if (!reason) invalid("content.errors.directionReasonRequired");
  if (reason.length > 500) invalid("content.errors.noteTooLong");
  const { c, row } = await openDirection(db, input.clientId, input.contentId, input.id);
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(contentCreativeDirections)
      .set({
        status: "rejected",
        decidedBy: actor.id,
        decidedAt: new Date(),
        decisionNote: reason,
      })
      .where(
        and(
          eq(contentCreativeDirections.id, row.id),
          eq(contentCreativeDirections.status, "proposed"),
        ),
      )
      .returning();
    if (!updated) conflict("content.errors.proposalDecided");
    await recordAuditEvent(tx, {
      actor,
      action: "content.direction_rejected",
      entity: "content",
      entityId: c.id,
      clientId: c.clientId,
      meta: { number: row.number },
    });
    return updated;
  });
}

/** The accepted direction as a prompt block for the Copywriter and the Art Director. */
export function directionBlock(d: CreativeDirection | null | undefined, only?: number): string {
  if (!d) return "";
  const slides = d.slides
    .filter((s) => only === undefined || s.position === only)
    .map((s) => `- slide ${s.position}: ${s.intent}${s.visual ? ` (visual: ${s.visual})` : ""}`);
  return [
    "## Creative direction (accepted by the agency)",
    `Concept: ${d.concept}`,
    d.thread && `Thread: ${d.thread}`,
    d.tone && `Tone: ${d.tone}`,
    slides.length ? `Slides:\n${slides.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
