import { fail, json } from "@/lib/http";
import { syncGoogleDrive } from "@/lib/sync/drive";

export const runtime = "nodejs";

export async function POST() {
  try { return json(await syncGoogleDrive()); }
  catch (error) { return fail(error); }
}
