import {z} from "zod";
import {auth,requireClient,json,fail,ApiFailure,dbError} from "@/lib/http";
export const runtime="nodejs";
type P={params:Promise<{clientId:string;jobId:string}>};
export async function DELETE(_request:Request,{params}:P){
 try{
  const {clientId,jobId}=await params,ctx=await auth();
  await requireClient(ctx,clientId);
  if(!z.uuid().safeParse(jobId).success)throw new ApiFailure(400,"Job ID non valido");
  const {data:job,error:lookupErr}=await ctx.db.from("ai_jobs")
   .select("id").eq("id",jobId).eq("client_id",clientId).maybeSingle();
  dbError(lookupErr);
  if(!job)throw new ApiFailure(404,"Lavoro non trovato");
  const {data,error}=await ctx.db.rpc("forgecy_cancel_ai_job",{p_job_id:jobId});
  dbError(error);
  if(!data)throw new ApiFailure(409,"Solo un lavoro in attesa può essere annullato");
  return json({cancelled:true});
 }catch(e){return fail(e);}
}
