import { fail, json } from "@/lib/http";
import { getAutomaticBackupSettings, saveAutomaticBackupSettings } from "@/lib/sync/local-backups";

export const runtime = "nodejs";

export async function GET() {
  try { return json({ settings: getAutomaticBackupSettings() }); }
  catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    return json({ settings: saveAutomaticBackupSettings(input) });
  } catch (error) { return fail(error); }
}
