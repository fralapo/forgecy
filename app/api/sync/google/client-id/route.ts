import { fail, json } from "@/lib/http";
import { configureGoogleDriveClientId } from "@/lib/sync/drive";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { clientId?: unknown };
    return json(configureGoogleDriveClientId(body.clientId));
  } catch (error) { return fail(error); }
}
