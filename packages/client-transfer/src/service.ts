/**
 * Full client export (spec page 68): Admins only (`clients.transfer`), never an agent.
 * The worker builds the ZIP; the person downloads it through a short-lived link.
 */
import {
  assertCan,
  CLIENT_EXPORT_LINK_HOURS,
  clientTransferAreas,
  PermissionDeniedError,
  type Actor,
  type ClientTransferArea,
} from "@forgecy/core";
import {
  clientExports,
  clients,
  desc,
  eq,
  recordAuditEvent,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import { localizedError } from "@forgecy/i18n";
import { enqueueJob, type JobQueues } from "@forgecy/jobs";
import { z } from "zod";
import { clientTables } from "./graph";
import { clientExportJob } from "./jobs";

export type ClientExportRow = typeof clientExports.$inferSelect;

function admin(actor: Actor): Extract<Actor, { type: "user" }> {
  if (actor.type !== "user") throw new PermissionDeniedError("clients.transfer", actor);
  assertCan(actor, "clients.transfer");
  return actor;
}

export const exportInputSchema = z.object({
  clientId: z.uuid(),
  areas: z.array(z.enum(clientTransferAreas)).min(1),
  excludeUnapprovedAi: z.boolean().default(true),
  includeAgencyTemplates: z.boolean().default(false),
});
export type ExportInput = z.input<typeof exportInputSchema>;

/** “Export client”: queues the package; the worker writes it. */
export async function startClientExport(
  deps: { db: Database; queues: JobQueues },
  actor: Actor,
  input: ExportInput,
): Promise<ClientExportRow> {
  const user = admin(actor);
  const parsed = exportInputSchema.safeParse(input);
  if (!parsed.success) throw localizedError("validation", "clientTransfer.errors.invalidInput");
  const { db } = deps;
  const [client] = await db.select().from(clients).where(eq(clients.id, parsed.data.clientId));
  if (!client) throw localizedError("not_found", "clientTransfer.errors.clientNotFound");
  const [row] = await db
    .insert(clientExports)
    .values({
      clientId: client.id,
      clientName: client.name,
      areas: [...new Set(parsed.data.areas)],
      options: {
        excludeUnapprovedAi: parsed.data.excludeUnapprovedAi,
        includeAgencyTemplates: parsed.data.includeAgencyTemplates,
      },
      createdBy: user.id,
    })
    .returning();
  const job = await enqueueJob(db, deps.queues, {
    kind: clientExportJob,
    payload: { exportId: row!.id },
    clientId: client.id,
    entity: "client_export",
    entityId: row!.id,
    createdBy: user.id,
  });
  const [updated] = await db
    .update(clientExports)
    .set({ jobId: job.id })
    .where(eq(clientExports.id, row!.id))
    .returning();
  await recordAuditEvent(db, {
    actor: user,
    action: "client.export.start",
    entity: "client_export",
    entityId: row!.id,
    clientId: client.id,
    meta: { areas: row!.areas, options: row!.options },
  });
  return updated!;
}

/** Recent exports, newest first, with the name of who made them. */
export async function listClientExports(db: Database, actor: Actor, limit = 50) {
  admin(actor);
  return db
    .select({ export: clientExports, createdByName: users.name })
    .from(clientExports)
    .leftJoin(users, eq(users.id, clientExports.createdBy))
    .orderBy(desc(clientExports.createdAt))
    .limit(limit);
}

/** A download link valid 24 hours; null when the file is not ready (or gone). */
export async function clientExportDownloadUrl(
  deps: { db: Database; storage: StorageDriver },
  actor: Actor,
  id: string,
): Promise<string | null> {
  const user = admin(actor);
  const [row] = await deps.db.select().from(clientExports).where(eq(clientExports.id, id));
  if (!row || row.status !== "ready" || !row.storageKey) return null;
  if (!(await deps.storage.exists(row.storageKey))) return null;
  await recordAuditEvent(deps.db, {
    actor: user,
    action: "client.export.download",
    entity: "client_export",
    entityId: row.id,
    clientId: row.clientId ?? undefined,
  });
  return deps.storage.signedUrl(row.storageKey, {
    expiresInSeconds: CLIENT_EXPORT_LINK_HOURS * 3600,
    disposition: "attachment",
    filename: row.fileName ?? "client.zip",
  });
}

/** Rows per area for the summary, and the bytes of the client's images. */
export async function estimateClientExport(
  db: Database,
  actor: Actor,
  clientId: string,
): Promise<{ rows: Record<ClientTransferArea, number>; imageBytes: number }> {
  admin(actor);
  const rows = Object.fromEntries(clientTransferAreas.map((a) => [a, 0])) as Record<
    ClientTransferArea,
    number
  >;
  for (const t of clientTables()) {
    if (t.area === "client" || !t.hasClientId) continue;
    const res = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(t.name)} where client_id = ${clientId}`,
    );
    rows[t.area] += res.rows[0]?.n ?? 0;
  }
  const activity = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from audit_events where client_id = ${clientId}`,
  );
  rows.activity = activity.rows[0]?.n ?? 0;
  const bytes = await db.execute<{ n: number }>(
    sql`select coalesce(sum(size), 0)::float8 as n from assets where client_id = ${clientId}`,
  );
  return { rows, imageBytes: bytes.rows[0]?.n ?? 0 };
}
