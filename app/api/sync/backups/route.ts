import { fail, json } from "@/lib/http";
import { createAutomaticBackup, listAutomaticBackups } from "@/lib/sync/local-backups";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try { return json({ backups: listAutomaticBackups() }); }
  catch (error) { return fail(error); }
}

export async function POST() {
  try { return json({ backup: await createAutomaticBackup() }, 201); }
  catch (error) { return fail(error); }
}
