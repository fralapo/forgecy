import { auth, requireClient, fail, json, ApiFailure, dbError, audit, read } from "@/lib/http";
import { z } from "zod";

export const runtime = "nodejs";

const mediaSchema = z.object({
  id: z.string().min(1).max(300),
  caption: z.string().max(10_000).nullable().optional(),
  permalink: z.string().url().max(2_000).nullable().optional(),
  media_type: z.string().max(80).nullable().optional(),
  timestamp: z.string().datetime().nullable().optional(),
  like_count: z.number().int().nonnegative().nullable().optional(),
  comments_count: z.number().int().nonnegative().nullable().optional(),
  insights: z.record(z.string(), z.number().nonnegative().nullable()).optional(),
}).strict();
const snapshotSchema = z.object({
  account: z.object({
    username: z.string().max(30).optional(),
    followers_count: z.number().int().nonnegative().nullable().optional(),
    media_count: z.number().int().nonnegative().nullable().optional(),
  }).optional(),
  media: z.array(mediaSchema).max(500).optional(),
  account_insights: z.record(z.string(), z.number().nonnegative().nullable()).optional(),
}).strict().superRefine((snapshot, context) => {
  const hasAccountMetric = snapshot.account && (
    snapshot.account.followers_count !== undefined || snapshot.account.media_count !== undefined
  );
  const hasInsights = Boolean(snapshot.account_insights && Object.keys(snapshot.account_insights).length);
  if (!hasAccountMetric && !snapshot.media?.length && !hasInsights) {
    context.addIssue({ code: "custom", message: "Lo snapshot non contiene metriche da importare." });
  }
});
const payloadSchema = z.object({ accountId: z.uuid(), snapshot: snapshotSchema });

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const id = (await params).clientId;
    const ctx = await auth();
    await requireClient(ctx, id);
    const input = await read(request, payloadSchema);
    const { data: selected, error: accountError } = await ctx.db.from("social_accounts")
      .select("id,username").eq("id", input.accountId).eq("client_id", id)
      .eq("platform", "instagram").maybeSingle();
    dbError(accountError);
    if (!selected) throw new ApiFailure(404, "Profilo non trovato nel cliente selezionato");
    if (input.snapshot.account?.username && input.snapshot.account.username.toLowerCase() !== selected.username.toLowerCase()) {
      throw new ApiFailure(400, "Lo username del file non corrisponde al profilo selezionato.");
    }
    const profile = {
      ...input.snapshot,
      account: { ...input.snapshot.account, username: selected.username },
      source: "Import manuale dell’utente",
      measured: true,
      insights_status: input.snapshot.account_insights ? "imported" : "unavailable",
      metric_scope: "user_supplied_snapshot",
    };
    const { data: row, error: saveError } = await ctx.db.from("social_snapshots").insert({
      client_id: id,
      account_id: selected.id,
      data: profile,
      period: "user_import",
    }).select("id,collected_at").single();
    dbError(saveError, "Rilevazione importata non salvata");
    await audit(ctx, id, "instagram_snapshot_imported", selected.id, { source: "user_supplied_json" });
    return json({ snapshot: { username: selected.username, ...row }, message: "Rilevazione importata" });
  } catch (error) {
    return fail(error);
  }
}
