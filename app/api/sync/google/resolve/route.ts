import { z } from "zod";
import { fail, json, read } from "@/lib/http";
import { resolveDriveConflict } from "@/lib/sync/drive";

export const runtime = "nodejs";
const schema = z.discriminatedUnion("choice", [
  z.object({ choice: z.literal("local") }).strict(),
  z.object({ choice: z.literal("remote"), remoteFileId: z.string().min(1).max(200) }).strict(),
]);

export async function POST(request: Request) {
  try {
    const input = await read(request, schema);
    return json(await resolveDriveConflict(input.choice, input.choice === "remote" ? input.remoteFileId : undefined));
  } catch (error) { return fail(error); }
}
