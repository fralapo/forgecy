import { fail } from "@/lib/http";
import { createWorkspaceArchive } from "@/lib/sync/archive";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const { archive, manifest } = await createWorkspaceArchive();
    return new Response(archive, { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="forgecy-${manifest.createdAt.slice(0, 10)}.forgecy.zip"`,
      "Cache-Control": "no-store, private",
      "X-Forgecy-Snapshot-Hash": manifest.hash,
    } });
  } catch (error) { return fail(error); }
}
