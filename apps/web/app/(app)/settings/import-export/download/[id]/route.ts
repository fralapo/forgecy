import { clientExportDownloadUrl } from "@forgecy/client-transfer";
import { getDb } from "@forgecy/db";
import { createStorageFromEnv } from "@forgecy/files";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";

/** “Download”: a 24-hour link to the package (Admins only, checked in the service). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const back = new URL("/settings/import-export?missing=1", env.FORGECY_BASE_URL);
  if (!user.isAdmin) return NextResponse.redirect(back);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.redirect(back);
  const url = await clientExportDownloadUrl(
    { db: getDb(), storage: createStorageFromEnv(env) },
    user.actor,
    id.data,
  );
  return NextResponse.redirect(url ? new URL(url, env.FORGECY_BASE_URL) : back);
}
