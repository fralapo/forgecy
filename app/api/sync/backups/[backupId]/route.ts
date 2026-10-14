import { readAutomaticBackup } from "@/lib/sync/local-backups";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ backupId: string }> }) {
  const { backupId } = await params;
  try {
    const archive = readAutomaticBackup(backupId);
    return new Response(Uint8Array.from(archive), { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${backupId}"`,
      "Cache-Control": "no-store, private",
    } });
  } catch {
    return Response.json({ error: "Backup locale non trovato." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
