/** Worker handler of the full client export: writes the ZIP, stores it, tells who asked. */
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "@forgecy/core";
import { clientExports, eq, notify, recordAuditEvent } from "@forgecy/db";
import { createStorageFromEnv, type StorageDriver } from "@forgecy/files";
import { handle, UnrecoverableError, type JobContext, type JobHandlers } from "@forgecy/jobs";
import { writeClientPackage } from "./export";
import { clientExportJob } from "./jobs";

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

/** `...clientTransferHandlers()` in apps/worker. */
export function clientTransferHandlers(): JobHandlers {
  let storage: StorageDriver | undefined;
  return handle(clientExportJob, async (payload, ctx) => {
    storage ??= createStorageFromEnv(loadEnv());
    return runClientExport({ storage }, payload, ctx);
  });
}
