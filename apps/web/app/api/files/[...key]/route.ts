import { Readable } from "node:stream";
import {
  contentTypeForKey,
  createStorageFromEnv,
  fileSigningSecretFromEnv,
  isValidKey,
  verifySignedFileUrl,
} from "@forgecy/files";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Serves local-disk files through short-lived signed URLs (the signature is the
 * authorization, so the export worker and rendered pages can use them too).
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  const url = new URL(request.url);
  const disposition = url.searchParams.get("disp") ?? undefined;
  const filename = url.searchParams.get("fn") ?? undefined;
  if (!isValidKey(key)) return new Response("Not found", { status: 404 });
  const check = verifySignedFileUrl(
    key,
    url.searchParams.get("exp") ?? "",
    url.searchParams.get("sig") ?? "",
    fileSigningSecretFromEnv(env),
    {
      disposition:
        disposition === "attachment" || disposition === "inline" ? disposition : undefined,
      filename,
    },
  );
  if (!check.ok) return new Response("Forbidden", { status: 403 });
  const storage = createStorageFromEnv(env);
  const info = await storage.head(key);
  if (!info) return new Response("Not found", { status: 404 });
  const body = Readable.toWeb(await storage.get(key)) as ReadableStream<Uint8Array>;
  const headers = new Headers({
    "content-type": info.contentType ?? contentTypeForKey(key),
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
  });
  if (info.size !== undefined) headers.set("content-length", String(info.size));
  if (disposition === "attachment")
    headers.set(
      "content-disposition",
      `attachment; filename="${(filename ?? key.split("/").pop() ?? "file").replace(/"/g, "")}"`,
    );
  return new Response(body, { headers });
}
