/**
 * Lessons log of a brand: a correction a person made, written down as a rule. Anyone may
 * propose one, an agent included; only a person with `brand_identity.approve` confirms
 * (`accepted`) or turns it down (`rejected`), so a lesson never binds the brand on its own.
 */
import { assertCan, PermissionDeniedError, type Actor } from "@forgecy/core";
import { localizedError } from "@forgecy/i18n";
import {
  actorKey,
  and,
  brandLessons,
  desc,
  eq,
  recordAuditEvent,
  type Database,
} from "@forgecy/db";
import { z } from "zod";

export const lessonInputSchema = z.object({
  correction: z.string().trim().min(3).max(600),
  rule: z.string().trim().max(600).default(""),
});
export type LessonInput = z.input<typeof lessonInputSchema>;
export type BrandLesson = typeof brandLessons.$inferSelect;

export async function listLessons(
  db: Database,
  actor: Actor,
  clientId: string,
): Promise<BrandLesson[]> {
  assertCan(actor, "view", clientId);
  return db
    .select()
    .from(brandLessons)
    .where(eq(brandLessons.clientId, clientId))
    .orderBy(desc(brandLessons.createdAt))
    .limit(200);
}

/** A correction awaiting a person's decision. */
export async function proposeLesson(
  db: Database,
  actor: Actor,
  input: { clientId: string; lesson: LessonInput },
): Promise<BrandLesson> {
  assertCan(actor, "propose", input.clientId);
  const lesson = lessonInputSchema.parse(input.lesson);
  const [row] = await db
    .insert(brandLessons)
    .values({ ...lesson, clientId: input.clientId, proposedBy: actorKey(actor) })
    .returning();
  await recordAuditEvent(db, {
    actor,
    action: "brand.lesson_proposed",
    entity: "brand_lesson",
    entityId: row!.id,
    clientId: input.clientId,
  });
  return row!;
}

/** A person confirms or rejects a proposed lesson; agents never do. */
export async function decideLesson(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; decision: "accepted" | "rejected" },
): Promise<BrandLesson> {
  assertCan(actor, "brand_identity.approve", input.clientId);
  if (actor.type !== "user") throw new PermissionDeniedError("brand_identity.approve", actor);
  const [row] = await db
    .update(brandLessons)
    .set({ status: input.decision, decidedBy: actor.id, decidedAt: new Date() })
    .where(
      and(
        eq(brandLessons.id, input.id),
        eq(brandLessons.clientId, input.clientId),
        eq(brandLessons.status, "proposed"),
      ),
    )
    .returning();
  if (!row) throw localizedError("not_found", "brand.errors.lessonNotFound");
  await recordAuditEvent(db, {
    actor,
    action: `brand.lesson_${input.decision}`,
    entity: "brand_lesson",
    entityId: row.id,
    clientId: input.clientId,
  });
  return row;
}
