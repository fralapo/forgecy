import { uploadScreenshots, uploadTable, type UploadedFile } from "@forgecy/audit";
import { AUDIT_LIMITS, ForgecyError, socialChannels, type SocialChannel } from "@forgecy/core";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { auditDeps } from "../_lib/server";

export const dynamic = "force-dynamic";

const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

/**
 * Social evidence uploads (Page 8). Multipart, so they are not bound by the 1 MB
 * server action limit; each file is still checked by magic bytes and size.
 */
export const POST = withUser(async (user, request: Request) => {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_TOTAL_BYTES)
    throw new ForgecyError("validation", "Caricamento troppo grande: dividilo in più parti.");
  const form = await request.formData();
  const auditId = String(form.get("auditId") ?? "");
  const channel = String(form.get("channel") ?? "") as SocialChannel;
  const kind = String(form.get("kind") ?? "");
  if (!socialChannels.includes(channel)) throw new ForgecyError("validation", "Canale non valido");
  const files: UploadedFile[] = [];
  for (const entry of form.getAll("files")) {
    if (typeof entry === "string") continue;
    files.push({
      name: entry.name,
      mime: entry.type,
      bytes: new Uint8Array(await entry.arrayBuffer()),
    });
  }
  if (files.length > AUDIT_LIMITS.maxScreenshotsPerChannel)
    throw new ForgecyError("validation", "Troppi file in un solo caricamento.");
  const deps = await auditDeps();
  if (kind === "screenshots") {
    const res = await uploadScreenshots(deps, user.actor, { auditId, channel, files });
    revalidatePath("/audit", "layout");
    return NextResponse.json(res);
  }
  if (kind === "table") {
    const file = files[0];
    if (!file) throw new ForgecyError("validation", "Scegli un file CSV o XLSX.");
    const res = await uploadTable(deps, user.actor, { auditId, channel, file });
    revalidatePath("/audit", "layout");
    return NextResponse.json(res);
  }
  throw new ForgecyError("validation", "Tipo di caricamento non valido");
});
