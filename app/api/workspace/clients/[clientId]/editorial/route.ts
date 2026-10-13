import {z} from "zod";
import {auth,requireClient,read,json,fail,dbError,ApiFailure,audit} from "@/lib/http";
export const runtime="nodejs";
type Args={params:Promise<{clientId:string}>};
const calendarSchema=z.object({
 title:z.string().trim().min(1).max(240),
 channel:z.enum(["instagram","linkedin","facebook","website","email"]),
 planned_at:z.iso.datetime({offset:true}),
 timezone:z.string().trim().min(3).max(80).default("Europe/Rome"),
 status:z.enum(["idea","planned","ready","completed","cancelled"]).default("planned"),
 content_id:z.uuid().nullable().default(null),
 notes:z.string().trim().max(4000).default("")
}).strict();
export async function GET(_req:Request,{params}:Args){
 try{
  const id=(await params).clientId,ctx=await auth();await requireClient(ctx,id);
  const {data,error}=await ctx.db.from("editorial_entries").select("*")
   .eq("client_id",id).order("planned_at",{ascending:true}).limit(250);
  dbError(error,"Impossibile leggere il calendario");
  return json({entries:data||[]});
 }catch(e){return fail(e)}
}
export async function POST(request:Request,{params}:Args){
 try{
  const id=(await params).clientId,ctx=await auth();await requireClient(ctx,id);
  const payload=await read(request,calendarSchema);
  if(payload.content_id){
   const {data:linked,error}=await ctx.db.from("contents").select("id,channel,status")
     .eq("client_id",id).eq("id",payload.content_id).maybeSingle();
   dbError(error);
   if(!linked)throw new ApiFailure(404,"Il contenuto non appartiene al cliente");
   if(linked.channel!==payload.channel)
     throw new ApiFailure(409,"Il canale del calendario non corrisponde al contenuto");
   if(linked.status==="stale")throw new ApiFailure(409,"Il contenuto va aggiornato prima di pianificarlo");
  }
  if(Date.parse(payload.planned_at)<Date.now()-365*86_400_000)
   throw new ApiFailure(400,"La data è troppo lontana nel passato");
  const {data,error}=await ctx.db.from("editorial_entries")
    .insert({...payload,client_id:id,created_by:ctx.user.id})
    .select().single();
  dbError(error,"Non è stato possibile creare la voce editoriale");
  await audit(ctx,id,"editorial_entry_created",data.id,{channel:data.channel});
  return json({entry:data},201);
 }catch(e){return fail(e)}
}
