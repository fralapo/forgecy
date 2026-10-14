import { fail, json } from "@/lib/http";
import { googleDriveFlow } from "@/lib/sync/drive";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ flowId: string }> }) {
  try { return json(googleDriveFlow((await params).flowId)); }
  catch (error) { return fail(error); }
}
