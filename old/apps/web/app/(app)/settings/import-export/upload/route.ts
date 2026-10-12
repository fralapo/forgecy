import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { clientImportKey, registerClientImport } from "@forgecy/client-transfer";
import { CLIENT_PACKAGE_MAX_BYTES } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { createStorageFromEnv } from "@forgecy/files";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Step File of “Import client”: the ZIP arrives as the raw request body (with upload
 * progress in the browser) and is streamed to storage; the worker then checks it.
 * Not behind the proxy (see proxy.ts), so the session is checked here.
 */
export async function PUT(request: Request) {
  const t = await getTranslations("clientTransfer.errors");
  const fail = (status: number, error: string) => NextResponse.json({ error }, { status });
  const user = await getCurrentUser();
  if (!user) return fail(401, t("uploadFailed"));
  if (!user.isAdmin) return fail(403, (await getTranslations("admin"))("adminOnly"));
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!/\.zip$/i.test(name)) return fail(400, t("notZip"));
  const bytes = Number(request.headers.get("content-length") ?? 0);
  if (bytes > CLIENT_PACKAGE_MAX_BYTES) {
    const format = await getFormat();
    const size = format.number(CLIENT_PACKAGE_MAX_BYTES / 1024 ** 3, {
      style: "unit",
      unit: "gigabyte",
    });
    return fail(413, t("fileTooLarge", { size }));
  }
  if (!bytes || !request.body) return fail(400, t("notZip"));

  const id = randomUUID();
  const storage = createStorageFromEnv(env);
  const key = clientImportKey(id);
  try {
    await storage.put(key, Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>), {
      contentType: "application/zip",
      contentLength: bytes,
    });
    const stored = await storage.head(key);
    if (!stored || stored.size !== bytes) {
      await storage.delete(key);
      return fail(400, t("uploadFailed"));
    }
    await registerClientImport({ db: getDb(), queues: await getQueues() }, user.actor, {
      id,
      fileName: name,
      bytes,
    });
  } catch (err) {
    // Nothing is left behind; the error still reaches the server log.
    await storage.delete(key).catch(() => {});
    throw err;
  }
  return NextResponse.json({ id });
}
