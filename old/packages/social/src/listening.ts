/**
 * Listening grid (ADR 0025): the agency logs verbatim signals from a client's audience by
 * hand. No scraping, no AI. Reads need `view` on the client, writes need `project.edit`,
 * which agents never hold.
 */
import {
  assertCan,
  listeningPlatforms,
  listeningStatuses,
  type Actor,
  type ListeningStatus,
} from "@forgecy/core";
import { and, desc, eq, listeningSignals, recordAuditEvent, sql, type Database } from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import { z } from "zod";

export type ListeningSignal = typeof listeningSignals.$inferSelect;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const signalInputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  platform: z.enum(listeningPlatforms).default("instagram"),
  url: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^https?:\/\//i.test(v), "url")
    .nullable()
    .optional(),
  occurredAt: z.coerce.date().optional(),
  tag: optionalText(60),
});
export type SignalInput = z.input<typeof signalInputSchema>;

export const SIGNAL_PAGE_SIZE = 100;

export async function listSignals(
  db: Database,
  actor: Actor,
  clientId: string,
  filter: { tag?: string; status?: ListeningStatus } = {},
): Promise<ListeningSignal[]> {
  assertCan(actor, "view", clientId);
  return db
    .select()
    .from(listeningSignals)
    .where(
      and(
        eq(listeningSignals.clientId, clientId),
        filter.tag ? eq(listeningSignals.tag, filter.tag) : undefined,
        filter.status ? eq(listeningSignals.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(listeningSignals.occurredAt), desc(listeningSignals.createdAt))
    .limit(SIGNAL_PAGE_SIZE);
}

/** Tags in use for a client, for the filter. */
export async function listSignalTags(
  db: Database,
  actor: Actor,
  clientId: string,
): Promise<string[]> {
  assertCan(actor, "view", clientId);
  const rows = await db
    .selectDistinct({ tag: listeningSignals.tag })
    .from(listeningSignals)
    .where(and(eq(listeningSignals.clientId, clientId), sql`${listeningSignals.tag} is not null`))
    .orderBy(listeningSignals.tag);
  return rows.map((r) => r.tag!);
}

export async function getSignal(
  db: Database,
  actor: Actor,
  clientId: string,
  id: string,
): Promise<ListeningSignal | null> {
  assertCan(actor, "view", clientId);
  const [row] = await db
    .select()
    .from(listeningSignals)
    .where(and(eq(listeningSignals.id, id), eq(listeningSignals.clientId, clientId)));
  return row ?? null;
}

export async function createSignal(
  db: Database,
  actor: Actor,
  input: { clientId: string; signal: SignalInput },
): Promise<ListeningSignal> {
  assertCan(actor, "project.edit", input.clientId);
  const s = signalInputSchema.parse(input.signal);
  const [row] = await db
    .insert(listeningSignals)
    .values({
      clientId: input.clientId,
      text: s.text,
      platform: s.platform,
      url: s.url ?? null,
      ...(s.occurredAt ? { occurredAt: s.occurredAt } : {}),
      tag: s.tag ?? null,
      createdBy: actor.type === "user" ? actor.id : null,
    })
    .returning();
  await recordAuditEvent(db, {
    actor,
    action: "listening.signal_created",
    entity: "listening_signal",
    entityId: row!.id,
    clientId: input.clientId,
  });
  return row!;
}

export async function updateSignal(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; signal: SignalInput },
): Promise<ListeningSignal> {
  assertCan(actor, "project.edit", input.clientId);
  const s = signalInputSchema.parse(input.signal);
  const [row] = await db
    .update(listeningSignals)
    .set({
      text: s.text,
      platform: s.platform,
      url: s.url ?? null,
      ...(s.occurredAt ? { occurredAt: s.occurredAt } : {}),
      tag: s.tag ?? null,
    })
    .where(and(eq(listeningSignals.id, input.id), eq(listeningSignals.clientId, input.clientId)))
    .returning();
  if (!row) throw localizedError("not_found", "social.errors.signalNotFound");
  await recordAuditEvent(db, {
    actor,
    action: "listening.signal_updated",
    entity: "listening_signal",
    entityId: row.id,
    clientId: input.clientId,
  });
  return row;
}

/** Marks a signal new, recurring, used or dismissed. */
export async function setSignalStatus(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; status: ListeningStatus },
): Promise<ListeningSignal> {
  assertCan(actor, "project.edit", input.clientId);
  const status = z.enum(listeningStatuses).parse(input.status);
  const [row] = await db
    .update(listeningSignals)
    .set({ status })
    .where(and(eq(listeningSignals.id, input.id), eq(listeningSignals.clientId, input.clientId)))
    .returning();
  if (!row) throw localizedError("not_found", "social.errors.signalNotFound");
  await recordAuditEvent(db, {
    actor,
    action: "listening.signal_marked",
    entity: "listening_signal",
    entityId: row.id,
    clientId: input.clientId,
    meta: { status },
  });
  return row;
}

export async function deleteSignal(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string },
): Promise<void> {
  assertCan(actor, "project.edit", input.clientId);
  const deleted = await db
    .delete(listeningSignals)
    .where(and(eq(listeningSignals.id, input.id), eq(listeningSignals.clientId, input.clientId)))
    .returning({ id: listeningSignals.id });
  if (!deleted.length) throw localizedError("not_found", "social.errors.signalNotFound");
  await recordAuditEvent(db, {
    actor,
    action: "listening.signal_deleted",
    entity: "listening_signal",
    entityId: input.id,
    clientId: input.clientId,
  });
}

/** The brief's trigger field holds 200 characters; a longer signal is cut at a word. */
export function signalTrigger(text: string, max = 200): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
