import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { backupPath, isBackupName } from "@forgecy/backup";
import { assertCan } from "@forgecy/core";
import { recordAuditEvent, getDb } from "@forgecy/db";
import { resolveMediaRoot } from "@forgecy/files";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { env } from "@/lib/env";

/** Admin download of a backup archive from data/backups. */
export const GET = withUser(
  async (user, _req: Request, { params }: { params: Promise<{ name: string }> }) => {
    assertCan(user.actor, "system.backup");
    const { name } = await params;
    if (!isBackupName(name)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const file = backupPath(resolveMediaRoot(env.FORGECY_DATA_DIR), name);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await recordAuditEvent(getDb(), {
      actor: user.actor,
      action: "backup_downloaded",
      entity: "backup",
      entityId: name,
    });
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        "content-type": "application/gzip",
        "content-length": String(info.size),
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  },
);
