import { z } from "zod";
import { auth, requireClient, fail, json, ApiFailure, dbError, audit, read } from "@/lib/http";
import { collectPublicInstagramProfile } from "@/lib/instagram-public-profile";

export const runtime = "nodejs";
const schema = z.object({ accountId: z.uuid() });
const MIN_INTERVAL_MS = 10 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const clientId = (await params).clientId;
    const ctx = await auth();
    await requireClient(ctx, clientId);
    const input = await read(request, schema);
    const { data: account, error: accountError } = await ctx.db.from("social_accounts")
      .select("id,username").eq("id", input.accountId).eq("client_id", clientId)
      .eq("platform", "instagram").maybeSingle();
    dbError(accountError);
    if (!account) throw new ApiFailure(404, "Profilo Instagram non trovato nel cliente selezionato.");

    const { data: recentRows, error: recentError } = await ctx.db.from("social_snapshots")
      .select("collected_at,data").eq("client_id", clientId).eq("account_id", account.id)
      .order("collected_at", { ascending: false }).limit(1);
    dbError(recentError);
    const recent = recentRows?.[0];
    if (recent?.data?.metric_scope === "public_profile_page") {
      const elapsed = Date.now() - Date.parse(recent.collected_at);
      if (Number.isFinite(elapsed) && elapsed < MIN_INTERVAL_MS) {
        const waitMinutes = Math.max(1, Math.ceil((MIN_INTERVAL_MS - elapsed) / 60_000));
        throw new ApiFailure(429, `Profilo aggiornato da poco. Riprova tra circa ${waitMinutes} minuti.`);
      }
    }

    const snapshot = await collectPublicInstagramProfile(account.username);
    const { data: row, error: saveError } = await ctx.db.from("social_snapshots").insert({
      client_id: clientId,
      account_id: account.id,
      data: snapshot,
      period: "public_profile_manual",
    }).select("id,collected_at").single();
    dbError(saveError, "Rilevazione pubblica non salvata.");
    await audit(ctx, clientId, "instagram_public_profile_collected", account.id, { source: "anonymous_public_html", metrics: Object.keys(snapshot.account) });
    return json({ snapshot: { username: account.username, ...row }, message: "Conteggi pubblici Instagram aggiornati." });
  } catch (error) {
    return fail(error);
  }
}
