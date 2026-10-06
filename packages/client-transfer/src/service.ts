/**
 * Full client export and import (spec page 68): Admins only (`clients.transfer`), never
 * an agent. The worker builds and reads the ZIPs; nothing of an import is written to the
 * client tables before the person confirms it.
 */
import {
  assertCan,
  CLIENT_EXPORT_LINK_HOURS,
  clientImportChoicesSchema,
  clientTransferAreas,
  PermissionDeniedError,
  templateConflictId,
  type Actor,
  type ClientTransferArea,
} from "@forgecy/core";
import {
  and,
  clientExports,
  clientImports,
  clients,
  desc,
  eq,
  inArray,
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
import { clientExportJob, clientImportJob, clientImportVerifyJob } from "./jobs";

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

export type ClientImportRow = typeof clientImports.$inferSelect;

/** Where the uploaded package waits until the import ends. */
export function clientImportKey(id: string): string {
  return `imports/clients/${id}/package.zip`;
}

/** Step File: the package is stored under `clientImportKey(id)`; the worker checks it. */
export async function registerClientImport(
  deps: { db: Database; queues: JobQueues },
  actor: Actor,
  input: { id: string; fileName: string; bytes: number },
): Promise<ClientImportRow> {
  const user = admin(actor);
  const { db } = deps;
  const [row] = await db
    .insert(clientImports)
    .values({
      id: input.id,
      fileName: input.fileName.slice(0, 200) || "package.zip",
      storageKey: clientImportKey(input.id),
      bytes: input.bytes,
      createdBy: user.id,
    })
    .returning();
  const job = await enqueueJob(db, deps.queues, {
    kind: clientImportVerifyJob,
    payload: { importId: row!.id },
    entity: "client_import",
    entityId: row!.id,
    createdBy: user.id,
  });
  const [updated] = await db
    .update(clientImports)
    .set({ jobId: job.id })
    .where(eq(clientImports.id, row!.id))
    .returning();
  await recordAuditEvent(db, {
    actor: user,
    action: "client.import.start",
    entity: "client_import",
    entityId: row!.id,
    meta: { fileName: row!.fileName, bytes: row!.bytes },
  });
  return updated!;
}

export async function getClientImport(
  db: Database,
  actor: Actor,
  id: string,
): Promise<ClientImportRow | null> {
  admin(actor);
  const [row] = await db.select().from(clientImports).where(eq(clientImports.id, id));
  return row ?? null;
}

/** Recent imports, newest first. */
export async function listClientImports(db: Database, actor: Actor, limit = 20) {
  admin(actor);
  return db
    .select({ import: clientImports, createdByName: users.name })
    .from(clientImports)
    .leftJoin(users, eq(users.id, clientImports.createdBy))
    .orderBy(desc(clientImports.createdAt))
    .limit(limit);
}

/**
 * Step Confirm: every conflict needs a choice; replacing a client needs its name typed.
 * Queues the import, which writes everything at the end in one transaction.
 */
export async function confirmClientImport(
  deps: { db: Database; queues: JobQueues },
  actor: Actor,
  id: string,
  input: { choices: unknown; confirmName?: string },
): Promise<ClientImportRow> {
  const user = admin(actor);
  const { db } = deps;
  const [row] = await db.select().from(clientImports).where(eq(clientImports.id, id));
  if (!row) throw localizedError("not_found", "clientTransfer.errors.importNotFound");
  if (row.status !== "ready")
    throw localizedError("conflict", "clientTransfer.errors.importNotReady");
  const parsed = clientImportChoicesSchema.safeParse(input.choices);
  if (!parsed.success) throw localizedError("validation", "clientTransfer.errors.invalidChoices");
  const choices = parsed.data;
  const clientConflict = row.conflicts.find((c) => c.kind === "client");
  if (choices.client.mode === "replace") {
    if (!clientConflict) throw localizedError("validation", "clientTransfer.errors.invalidChoices");
    const [target] = await db
      .select({ name: clients.name })
      .from(clients)
      .where(eq(clients.id, clientConflict.existingId));
    if (!target) throw localizedError("conflict", "clientTransfer.errors.clientNotFound");
    if ((input.confirmName ?? "").trim() !== target.name.trim())
      throw localizedError("validation", "clientTransfer.errors.typedNameMismatch");
  } else {
    const [taken] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.slug, choices.client.slug));
    if (taken)
      throw localizedError("conflict", "clientTransfer.errors.slugTaken", {
        slug: choices.client.slug,
      });
  }
  const open = row.conflicts.filter(
    (c) => c.kind === "template" && !choices.templates[templateConflictId(c.key, c.version)],
  );
  if (open.length)
    throw localizedError("validation", "clientTransfer.errors.unresolvedConflicts", {
      count: open.length,
    });
  const [claimed] = await db
    .update(clientImports)
    .set({ status: "importing", choices })
    .where(and(eq(clientImports.id, row.id), eq(clientImports.status, "ready")))
    .returning();
  if (!claimed) throw localizedError("conflict", "clientTransfer.errors.importNotReady");
  const job = await enqueueJob(db, deps.queues, {
    kind: clientImportJob,
    payload: { importId: row.id },
    entity: "client_import",
    entityId: row.id,
    createdBy: user.id,
  });
  const [updated] = await db
    .update(clientImports)
    .set({ jobId: job.id })
    .where(eq(clientImports.id, row.id))
    .returning();
  await recordAuditEvent(db, {
    actor: user,
    action: "client.import.confirm",
    entity: "client_import",
    entityId: row.id,
    clientId: choices.client.mode === "replace" ? clientConflict?.existingId : undefined,
    meta: { client: choices.client, templates: choices.templates },
  });
  return updated!;
}

/** “Cancel import” before the confirmation: nothing was written; the package is deleted. */
export async function cancelClientImport(
  deps: { db: Database; storage: StorageDriver },
  actor: Actor,
  id: string,
): Promise<boolean> {
  const user = admin(actor);
  const [row] = await deps.db
    .update(clientImports)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(
      and(
        eq(clientImports.id, id),
        inArray(clientImports.status, ["verifying", "ready", "invalid"]),
      ),
    )
    .returning();
  if (!row) return false;
  await deps.storage.delete(row.storageKey);
  await recordAuditEvent(deps.db, {
    actor: user,
    action: "client.import.cancel",
    entity: "client_import",
    entityId: row.id,
  });
  return true;
}
