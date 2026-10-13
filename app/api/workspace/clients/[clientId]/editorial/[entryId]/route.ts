import {z} from "zod";
import {auth,requireClient,read,json,fail,dbError,ApiFailure,audit} from "@/lib/http";
export const runtime="nodejs";
type Params={params:Promise<{clientId:string;entryId:string}>};
const schema=z.object({
 title:z.string().trim().min(1).max(240).optional(),
 channel:z.enum(["instagram","linkedin","facebook","website","email"]).optional(),
 planned_at:z.iso.datetime({offset:true}).optional(),
 timezone:z.string().trim().min(3).max(80).optional(),
 status:z.enum(["idea","planned","ready","completed","cancelled"]).optional(),
 notes:z.string().trim().max(4000).optional(),
 content_id:z.uuid().nullable().optional()
}).strict().refine(x=>Object.keys(x).length>0,"Non ci sono modifiche");
export async function PATCH(request:Request,{params}:Params){
 try{
  const {clientId,entryId}=await params,ctx=await auth();await requireClient(ctx,clientId);
  if(!z.uuid().safeParse(entryId).success)throw new ApiFailure(400,"ID voce non valido");
  const input=await read(request,schema);
  const {data:previous,error:readError}=await ctx.db.from("editorial_entries")
    .select("id,content_id,channel").eq("client_id",clientId).eq("id",entryId).maybeSingle();
  dbError(readError);
  if(!previous)throw new ApiFailure(404,"Voce del calendario non trovata");
  const linkedId=input.content_id===undefined?previous.content_id:input.content_id;
  const nextChannel=input.channel??previous.channel;
  if(linkedId){
   const {data:linked,error}=await ctx.db.from("contents").select("id,channel,status")
      .eq("id",linkedId).eq("client_id",clientId).maybeSingle();
   dbError(error);
   if(!linked)throw new ApiFailure(404,"Contenuto non presente nel cliente");
   if(linked.channel!==nextChannel)throw new ApiFailure(409,"Il canale non coincide con il contenuto");
   if(linked.status==="stale")throw new ApiFailure(409,"Aggiorna prima il contenuto obsoleto");
  }
  const {data,error}=await ctx.db.from("editorial_entries").update(input)
     .eq("id",entryId).eq("client_id",clientId).select().maybeSingle();
  dbError(error,"Aggiornamento del calendario non riuscito");
  if(!data)throw new ApiFailure(404,"Voce del calendario non trovata");
  await audit(ctx,clientId,"editorial_entry_updated",entryId);
  return json({entry:data});
 }catch(e){return fail(e)}
}
export async function DELETE(_request:Request,{params}:Params){
 try{
  const {clientId,entryId}=await params,ctx=await auth();await requireClient(ctx,clientId);
  if(!z.uuid().safeParse(entryId).success)throw new ApiFailure(400,"ID voce non valido");
  const {data,error}=await ctx.db.from("editorial_entries").delete()
     .eq("client_id",clientId).eq("id",entryId).select("id").maybeSingle();
  dbError(error,"Eliminazione non riuscita");
  if(!data)throw new ApiFailure(404,"Voce non trovata");
  await audit(ctx,clientId,"editorial_entry_deleted",entryId);
  return json({deleted:true});
 }catch(e){return fail(e)}
}
