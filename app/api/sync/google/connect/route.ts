import { beginGoogleDriveOAuth } from "@/lib/sync/drive";
import { fail, json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  try { return json(await beginGoogleDriveOAuth()); }
  catch (error) { return fail(error); }
}
