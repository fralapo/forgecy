import { fail, json } from "@/lib/http";
import { googleDriveStatus } from "@/lib/sync/drive";

export const runtime = "nodejs";

export async function GET() {
  try { return json(await googleDriveStatus()); }
  catch (error) { return fail(error); }
}
