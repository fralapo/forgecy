import { fail, json } from "@/lib/http";
import { createAutomaticBackup, getAutomaticBackupStatus, listAutomaticBackups } from "@/lib/sync/local-backups";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const status = getAutomaticBackupStatus();
  try { return json({ backups: listAutomaticBackups(), status, listError: null }); }
  catch {
    return json({
      backups: [], status,
      listError: "La cartella dei backup non è disponibile. Controlla il disco o il servizio di sincronizzazione.",
    });
  }
}

export async function POST() {
  try { return json({ backup: await createAutomaticBackup() }, 201); }
  catch (error) { return fail(error); }
}
