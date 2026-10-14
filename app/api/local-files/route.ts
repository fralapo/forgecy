import { readWorkspaceFile } from "@/lib/local-db/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const { bytes, contentType } = readWorkspaceFile(url.searchParams.get("bucket") || "", url.searchParams.get("path") || "", url.searchParams.get("token") || "");
    return new Response(bytes, { headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch {
    return Response.json({ error: "File non trovato" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
