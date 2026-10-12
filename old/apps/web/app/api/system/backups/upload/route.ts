import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { BackupInvalidError, saveUploadedBackup } from "@forgecy/backup";
import { assertCan } from "@forgecy/core";
import { getDb, recordAuditEvent } from "@forgecy/db";
import { resolveMediaRoot } from "@forgecy/files";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { env } from "@/lib/env";

/**
 * Admin upload of a backup made elsewhere (page 67, restore origin "Upload a backup
 * file"). The body is the raw .tar.gz, streamed to data/backups; a file that is not a
 * Forgecy backup is removed and refused with BACKUP-INVALID.
 */
export const POST = withUser(async (user, req: Request) => {
  assertCan(user.actor, "system.backup");
  if (!req.body) return NextResponse.json({ error: "BACKUP-INVALID" }, { status: 400 });
  try {
    const saved = await saveUploadedBackup(
      resolveMediaRoot(env.FORGECY_DATA_DIR),
      Readable.fromWeb(req.body as WebReadableStream<Uint8Array>),
      { uploadedBy: user.id },
    );
    await recordAuditEvent(getDb(), {
      actor: user.actor,
      action: "backup_uploaded",
      entity: "backup",
      entityId: saved.name,
      meta: { sizeBytes: saved.sizeBytes },
    });
    return NextResponse.json({ name: saved.name });
  } catch (err) {
    if (err instanceof BackupInvalidError)
      return NextResponse.json({ error: "BACKUP-INVALID" }, { status: 400 });
    if ((err as NodeJS.ErrnoException).code === "ENOSPC")
      return NextResponse.json({ error: "DISK-FULL" }, { status: 507 });
    throw err;
  }
});
