import { NextResponse } from "next/server";
import { z } from "zod";
import { localDb, LOCAL_OWNER_ID } from "./local-db";

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
export const MAX_JSON_BODY_BYTES=200_000;
export async function read<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType=request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if(contentType!=="application/json" && !contentType?.endsWith("+json"))
    throw new ApiFailure(415,"È necessario Content-Type: application/json");
  const declaredRaw=request.headers.get("content-length");
  if(declaredRaw!==null){
    const declared=Number(declaredRaw);
    if(!Number.isSafeInteger(declared)||declared<0)
      throw new ApiFailure(400,"Content-Length non valido");
    if(declared>MAX_JSON_BODY_BYTES)
      throw new ApiFailure(413,"Richiesta JSON troppo grande");
  }
  if(!request.body)throw new ApiFailure(400,"Corpo JSON mancante");
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_JSON_BODY_BYTES){
        await reader.cancel().catch(()=>undefined);
        throw new ApiFailure(413,"Richiesta JSON troppo grande");
      }
      chunks.push(value);
    }
  }catch(error){
    if(error instanceof ApiFailure)throw error;
    throw new ApiFailure(400,"Impossibile leggere la richiesta JSON");
  }finally{reader.releaseLock();}
  let raw:unknown;
  try{
    const all=new Uint8Array(size);
    let offset=0;
    for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
    raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all));
  }catch{throw new ApiFailure(400,"JSON non valido");}
  return schema.parse(raw);
}
export async function auth() {
  return { db: localDb(), user: { id: LOCAL_OWNER_ID, app_metadata: {}, user_metadata: {}, aud: "local", created_at: "" } };
}
export type Context = Awaited<ReturnType<typeof auth>> & {
  /** Set only by the privileged worker after checking job/client ownership. */
  workerRequestedBy?: string;
};
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
