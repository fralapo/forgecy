import { fail, json } from "@/lib/http";
import { disconnectGoogleDrive } from "@/lib/sync/drive";

export const runtime = "nodejs";

export async function POST() {
  try { await disconnectGoogleDrive(); return json({ disconnected: true }); }
  catch (error) { return fail(error); }
}
