import { NextResponse } from "next/server";
import { z } from "zod";
import { serverDb } from "./supabase";

export class ApiFailure extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function fail(error: unknown) {
  if (error instanceof ApiFailure) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: "Dati non validi", issues: error.issues }, 400);
  console.error("[forgecy]", error instanceof Error ? error.message : "Unexpected failure");
  return json({ error: "Errore interno. Riprova o controlla i log del server." }, 500);
}
export async function read<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (Number(request.headers.get("content-length") || 0) > 200_000) throw new ApiFailure(413,"Richiesta troppo grande");
  let raw: unknown;
  try { raw = await request.json(); } catch { throw new ApiFailure(400, "JSON non valido"); }
  return schema.parse(raw);
}
export async function auth() {
  const db = await serverDb();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new ApiFailure(401,"Accedi per continuare");
  return { db, user: data.user };
}
export type Context = Awaited<ReturnType<typeof auth>>;
export async function requireClient(ctx: Context, clientId: string) {
  if (!z.uuid().safeParse(clientId).success) throw new ApiFailure(400,"ID cliente non valido");
  const { data, error } = await ctx.db.from("clients").select("id,name,industry,website,profile").eq("id", clientId).maybeSingle();
  if (error) throw new ApiFailure(500,"Impossibile leggere il cliente");
  if (!data) throw new ApiFailure(404,"Cliente non trovato");
  return data;
}
export function dbError(error: {message:string}|null, msg="Operazione non riuscita") {
  if (error) { console.error("[db]",error.message); throw new ApiFailure(400,msg); }
}
export async function audit(ctx: Context, clientId: string, action: string, targetId?: string, details?: Record<string, unknown>) {
  const { error } = await ctx.db.from("audit_events").insert({
    client_id:clientId,actor_id:ctx.user.id,action,target_id:targetId ?? null,details:details ?? {}
  });
  if (error) console.error("[audit]",error.message);
}
