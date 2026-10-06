import { ForgecyError, type Actor, type AiPolicy } from "@forgecy/core";
import { audits, clients, eq, jobs, and, inArray, type Database } from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import { enqueueJob, type JobDefinition, type JobQueues } from "@forgecy/jobs";
import type { z } from "zod";
import { AUDIT_JOB_ENTITY } from "../jobs";

/** What the services need. Queues and storage are optional so read-only callers can skip them. */
export interface AuditDeps {
  db: Database;
  queues?: JobQueues;
  storage?: StorageDriver;
}

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type AuditRow = typeof audits.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;

export function userIdOf(actor: Actor): string | null {
  return actor.type === "user" ? actor.id : null;
}

export function requireQueues(deps: AuditDeps): JobQueues {
  if (!deps.queues) throw new ForgecyError("unavailable", "Coda dei job non disponibile");
  return deps.queues;
}

export function requireStorage(deps: AuditDeps): StorageDriver {
  if (!deps.storage) throw new ForgecyError("unavailable", "Archivio file non disponibile");
  return deps.storage;
}

export async function loadAudit(
  db: Database,
  auditId: string,
): Promise<{ audit: AuditRow; client: ClientRow }> {
  const [row] = await db
    .select({ audit: audits, client: clients })
    .from(audits)
    .innerJoin(clients, eq(clients.id, audits.clientId))
    .where(eq(audits.id, auditId));
  if (!row) throw new ForgecyError("not_found", "Audit non trovato");
  return row;
}

/** Audits that are archived or delivered are read-only. */
export function assertEditable(audit: AuditRow): void {
  if (audit.status === "archived" || audit.status === "delivered")
    throw new ForgecyError("conflict", "L'audit è chiuso: non si può più modificare.");
}

export function aiAllowed(policy: AiPolicy): boolean {
  return policy !== "no_ai";
}

export function assertAiAllowed(client: ClientRow): void {
  if (!aiAllowed(client.aiPolicy))
    throw new ForgecyError(
      "policy_blocked",
      "La policy di questo prospect non permette l'uso dell'AI. Puoi compilare le sezioni a mano.",
    );
}

/** Enqueue an audit job tied to the audit (jobs.entity = "audit"). */
export async function enqueueAuditJob<S extends z.ZodType>(
  deps: AuditDeps,
  input: {
    def: JobDefinition<S>;
    payload: z.input<S>;
    audit: Pick<AuditRow, "id" | "clientId">;
    createdBy?: string | null;
  },
) {
  return enqueueJob(deps.db, requireQueues(deps), {
    kind: input.def,
    payload: input.payload,
    clientId: input.audit.clientId,
    entity: AUDIT_JOB_ENTITY,
    entityId: input.audit.id,
    createdBy: input.createdBy ?? null,
  });
}

/** True when a job of this kind is already queued or running for the audit. */
export async function hasActiveJob(db: Database, auditId: string, kind: string): Promise<boolean> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.entity, AUDIT_JOB_ENTITY),
        eq(jobs.entityId, auditId),
        eq(jobs.kind, kind),
        inArray(jobs.status, ["queued", "retrying", "running"]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Postgres unique_violation, raised by the one-active-audit index. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
