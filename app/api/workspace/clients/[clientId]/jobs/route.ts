import {z} from "zod";
import {auth,requireClient,read,json,fail,ApiFailure,dbError} from "@/lib/http";
import {missionSchema} from "@/lib/schemas";
export const runtime="nodejs";
type P={params:Promise<{clientId:string}>};
const createJob=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("dossier"),payload:z.object({}).strict().default({})}),
  z.object({kind:z.literal("mission"),payload:missionSchema})
]);
export async function GET(_request:Request,{params}:P){
 try{
  const clientId=(await params).clientId,ctx=await auth();
  await requireClient(ctx,clientId);
  const {data,error}=await ctx.db.from("ai_jobs").select(
    "id,kind,status,attempts,max_attempts,created_at,updated_at,finished_at,error,result"
  ).eq("client_id",clientId).order("created_at",{ascending:false}).limit(30);
  dbError(error,"Impossibile leggere i lavori");
  return json({jobs:data||[]});
 }catch(e){return fail(e);}
}
export async function POST(request:Request,{params}:P){
 try{
  const clientId=(await params).clientId,ctx=await auth();
  await requireClient(ctx,clientId);
  const input=await read(request,createJob);
  if(input.kind==="mission"){
   const {data:current,error}=await ctx.db.from("dossiers")
     .select("status,knowledge_revision").eq("client_id",clientId)
     .order("version",{ascending:false}).limit(1).maybeSingle();
   dbError(error);
   const {data:client}=await ctx.db.from("clients").select("knowledge_revision")
     .eq("id",clientId).single();
   if(!current||current.status!=="approved"||
     current.knowledge_revision!==client?.knowledge_revision)
      throw new ApiFailure(409,"Prima approva un dossier aziendale attuale");
   if(input.payload.offer_id){
    const {data:offer}=await ctx.db.from("offers").select("id")
      .eq("client_id",clientId).eq("id",input.payload.offer_id)
      .eq("status","verified").maybeSingle();
    if(!offer)throw new ApiFailure(409,"L'offerta non è verificata");
   }
  }else{
   const {count,error}=await ctx.db.from("sources").select("id",{head:true,count:"exact"})
     .eq("client_id",clientId).eq("status","ready");
   dbError(error);
   const {count:offers,error:offerError}=await ctx.db.from("offers")
     .select("id",{head:true,count:"exact"}).eq("client_id",clientId).eq("status","verified");
   dbError(offerError);
   if(!count&&!offers)throw new ApiFailure(409,"Aggiungi prima una fonte pronta o un'offerta verificata");
  }
  const {data,error}=await ctx.db.rpc("forgecy_enqueue_ai_job",{
    p_client_id:clientId,p_kind:input.kind,p_payload:input.payload
  });
  dbError(error,"Non è possibile mettere in coda il lavoro: controlla limiti e configurazione");
  return json({job_id:data,status:"queued",message:"Lavoro accodato. Un worker configurato lo elaborerà."},202);
 }catch(e){return fail(e);}
}
