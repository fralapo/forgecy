/**
 * Worker handlers of the full client export (writes the ZIP, stores it, tells who asked)
 * and of the import (checks the package, then writes it after the confirmation).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createBackupArchive, pgDumpTo, type BackupEnv } from "@forgecy/backup";
import { loadEnv } from "@forgecy/core";
import {
  and,
  clientExports,
  clientImports,
  eq,
  migrationStatus,
  notify,
  recordAuditEvent,
  type Database,
} from "@forgecy/db";
import { createStorageFromEnv, type StorageDriver } from "@forgecy/files";
import { handle, UnrecoverableError, type JobContext, type JobHandlers } from "@forgecy/jobs";
import { writeClientPackage } from "./export";
import { importClientPackage } from "./import";
import { clientExportJob, clientImportJob, clientImportVerifyJob } from "./jobs";
import { verifyClientPackage } from "./verify";

export function exportFileName(slug: string, at: Date): string {
  const safe = slug.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "client";
  return `${safe}-forgecy-${at.toISOString().slice(0, 10)}.zip`;
}

export async function runClientExport(
  deps: { storage: StorageDriver },
  payload: { exportId: string },
  ctx: JobContext,
) {
  const { db } = ctx;
  const [row] = await db.select().from(clientExports).where(eq(clientExports.id, payload.exportId));
  if (!row) throw new UnrecoverableError("Client export not found");
  if (row.status === "ready") return { skipped: true };
  if (!row.clientId) throw new UnrecoverableError("The client no longer exists");
  await db
    .update(clientExports)
    .set({ status: "running", errorRef: null })
    .where(eq(clientExports.id, row.id));
  const dir = await mkdtemp(join(tmpdir(), "forgecy-client-export-"));
  try {
    const file = join(dir, "package.zip");
    const { manifest, counts } = await writeClientPackage(
      { db, storage: deps.storage },
      {
        clientId: row.clientId,
        areas: row.areas,
        excludeUnapprovedAi: row.options.excludeUnapprovedAi,
        includeAgencyTemplates: row.options.includeAgencyTemplates,
      },
      file,
      (pct) => ctx.progress(pct),
    );
    const { size } = await stat(file);
    const fileName = exportFileName(manifest.client.slug, new Date(manifest.exportedAt));
    const key = `exports/clients/${row.id}/${fileName}`;
    await deps.storage.put(key, createReadStream(file), {
      contentType: "application/zip",
      contentLength: size,
    });
    await db.transaction(async (tx) => {
      await tx
        .update(clientExports)
        .set({ status: "ready", storageKey: key, fileName, bytes: size, counts })
        .where(eq(clientExports.id, row.id));
      await recordAuditEvent(tx, {
        actor: "system",
        action: "client.export.ready",
        entity: "client_export",
        entityId: row.id,
        clientId: row.clientId!,
        meta: { bytes: size, counts },
      });
      await notify(tx, {
        kind: "client_export_ready",
        to: [row.createdBy],
        clientId: row.clientId,
        params: {},
        href: "/settings/import-export",
      });
    });
    return { bytes: size, counts };
  } catch (err) {
    await db
      .update(clientExports)
      .set({ status: "failed", errorRef: { key: "clientTransfer.errors.exportFailed" } })
      .where(eq(clientExports.id, row.id));
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Copies the uploaded package to a temporary file (yauzl needs random access). */
async function download(storage: StorageDriver, key: string, dir: string): Promise<string> {
  const file = join(dir, "package.zip");
  await pipeline(await storage.get(key), createWriteStream(file));
  return file;
}

export async function runClientImportVerify(
  deps: { storage: StorageDriver },
  payload: { importId: string },
  ctx: JobContext,
) {
  const { db } = ctx;
  const [row] = await db.select().from(clientImports).where(eq(clientImports.id, payload.importId));
  if (!row) throw new UnrecoverableError("Client import not found");
  if (row.status !== "verifying") return { skipped: true };
  const dir = await mkdtemp(join(tmpdir(), "forgecy-client-import-"));
  try {
    let v: Awaited<ReturnType<typeof verifyClientPackage>>;
    try {
      const file = await download(deps.storage, row.storageKey, dir);
      await ctx.progress(20);
      v = await verifyClientPackage(db, file, row.bytes);
    } catch (err) {
      // The row never stays in “verifying”: the person sees why and can upload again.
      await db
        .update(clientImports)
        .set({ status: "invalid", problems: ["unreadable"] })
        .where(and(eq(clientImports.id, row.id), eq(clientImports.status, "verifying")));
      throw err;
    }
    const status = v.problems.length ? "invalid" : "ready";
    // Cancelled meanwhile: the row stays cancelled.
    await db
      .update(clientImports)
      .set({
        status,
        report: v.report,
        problems: v.problems,
        conflicts: v.conflicts,
        resolved: v.resolved,
      })
      .where(and(eq(clientImports.id, row.id), eq(clientImports.status, "verifying")));
    if (status === "invalid") await deps.storage.delete(row.storageKey);
    return { status, problems: v.problems, conflicts: v.conflicts.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function failImport(db: Database, row: typeof clientImports.$inferSelect) {
  await db.transaction(async (tx) => {
    await tx
      .update(clientImports)
      .set({
        status: "failed",
        errorRef: { key: "clientTransfer.errors.importFailed" },
        finishedAt: new Date(),
      })
      .where(eq(clientImports.id, row.id));
    await recordAuditEvent(tx, {
      actor: "system",
      action: "client.import.failed",
      entity: "client_import",
      entityId: row.id,
    });
    await notify(tx, {
      kind: "client_import_failed",
      to: [row.createdBy],
      params: { file: row.fileName },
      href: `/settings/import-export?tab=import&importId=${row.id}`,
    });
  });
}

export async function runClientImport(
  deps: { storage: StorageDriver; backup: BackupEnv },
  payload: { importId: string },
  ctx: JobContext,
) {
  const { db } = ctx;
  const [row] = await db.select().from(clientImports).where(eq(clientImports.id, payload.importId));
  if (!row) throw new UnrecoverableError("Client import not found");
  if (row.status !== "importing" || !row.choices) return { skipped: true };
  const choices = row.choices;
  const replaceClientId =
    choices.client.mode === "replace"
      ? row.conflicts.find((c) => c.kind === "client")?.existingId
      : undefined;
  const dir = await mkdtemp(join(tmpdir(), "forgecy-client-import-"));
  try {
    if (replaceClientId) {
      // Spec: a replacement saves the database (and files) first.
      const migrations = await migrationStatus(db).catch(() => null);
      const backup = await createBackupArchive({
        dataDir: deps.backup.dataDir,
        mediaDir: deps.backup.mediaDir,
        dump: pgDumpTo(deps.backup.databaseUrl),
        kind: "pre_import",
        includeMedia: true,
        createdBy: row.createdBy,
        appVersion: deps.backup.appVersion ?? null,
        lastMigration: migrations?.lastApplied ?? null,
      });
      await db
        .update(clientImports)
        .set({ backupName: backup.name })
        .where(eq(clientImports.id, row.id));
    }
    await ctx.progress(30);
    const file = await download(deps.storage, row.storageKey, dir);
    await ctx.progress(40);
    const outcome = await importClientPackage({ db, storage: deps.storage }, file, {
      choices,
      replaceClientId,
    });
    await ctx.progress(90);
    await db.transaction(async (tx) => {
      await tx
        .update(clientImports)
        .set({
          status: "done",
          clientId: outcome.clientId,
          result: outcome.counts,
          finishedAt: new Date(),
        })
        .where(eq(clientImports.id, row.id));
      await recordAuditEvent(tx, {
        actor: "system",
        action: replaceClientId ? "client.import.replaced" : "client.import.created",
        entity: "client_import",
        entityId: row.id,
        clientId: outcome.clientId,
        meta: { counts: outcome.counts, skipped: outcome.skipped, fileName: row.fileName },
      });
      await notify(tx, {
        kind: "client_import_done",
        to: [row.createdBy],
        clientId: outcome.clientId,
        params: { client: outcome.name, ...outcome.summary },
        href: `/clients/${outcome.slug}`,
      });
    });
    await deps.storage.delete(row.storageKey);
    return { clientId: outcome.clientId, counts: outcome.counts };
  } catch (err) {
    await failImport(db, row);
    await deps.storage.delete(row.storageKey).catch(() => {});
    throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `...clientTransferHandlers(backupEnv)` in apps/worker. */
export function clientTransferHandlers(backup: BackupEnv): JobHandlers {
  let storage: StorageDriver | undefined;
  const store = () => (storage ??= createStorageFromEnv(loadEnv()));
  return {
    ...handle(clientExportJob, async (payload, ctx) =>
      runClientExport({ storage: store() }, payload, ctx),
    ),
    ...handle(clientImportVerifyJob, async (payload, ctx) =>
      runClientImportVerify({ storage: store() }, payload, ctx),
    ),
    ...handle(clientImportJob, async (payload, ctx) =>
      runClientImport({ storage: store(), backup }, payload, ctx),
    ),
  };
}
