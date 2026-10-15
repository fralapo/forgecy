import { z } from "zod";
import { auth, requireClient, fail, json, ApiFailure, dbError, audit, read } from "@/lib/http";
import { normalizeInstagramUsername } from "@/lib/instagram-username";

export const runtime = "nodejs";
const inputSchema = z.object({ username: z.string().trim().min(1).max(32) });

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const clientId = (await params).clientId;
    const ctx = await auth();
    await requireClient(ctx, clientId);
    const input = await read(request, inputSchema);
    const username=normalizeInstagramUsername(input.username);
    if (!username) {
      throw new ApiFailure(400, "Inserisci solo lo username pubblico Instagram, senza URL.");
    }
    const { data: existing, error: lookupError } = await ctx.db.from("social_accounts")
      .select("id,username")
      .eq("client_id", clientId)
      .eq("platform", "instagram")
      .eq("username", username)
      .maybeSingle();
    dbError(lookupError);
    if (existing) throw new ApiFailure(409, "Questo profilo Instagram è già aggiunto al cliente.");

    // Existing schema requires this legacy field; public profiles use no token or session.
    const { data, error } = await ctx.db.from("social_accounts").insert({
      client_id: clientId,
      platform: "instagram",
      remote_id: `public:${username}`,
      username,
      token_ciphertext: "",
      token_expires_at: null,
      needs_reauth: 0,
    }).select("id,username,remote_id").single();
    dbError(error, "Impossibile aggiungere il profilo Instagram");
    await audit(ctx, clientId, "instagram_local_account_added", data?.id, { username });
    return json({ account: data }, 201);
  } catch (error) {
    return fail(error);
  }
}
