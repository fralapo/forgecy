import {z} from "zod";
import type {Context} from "./http";
import {ApiFailure,audit,dbError} from "./http";
import {draftDossier,executeMission,contextForAI} from "./agent-team";
import {missionSchema} from "./schemas";
import {workerDb} from "./worker-db";

const jobSchema=z.object({
  id:z.uuid(),client_id:z.uuid(),requested_by:z.uuid(),
  kind:z.enum(["dossier","mission"]),payload:z.record(z.string(),z.unknown()),
  status:z.literal("running"),attempts:z.number().int().min(1),
  max_attempts:z.number().int().min(1).max(3)
});
type AiJob=z.infer<typeof jobSchema>;

export function nextFailure(job:Pick<AiJob,"attempts"|"max_attempts">,fatal:boolean,now=Date.now()){
 const retry=!fatal&&job.attempts<job.max_attempts;
 const delay=Math.min(10*60_000,60_000*2**Math.max(0,job.attempts-1));
 return {retry,run_after:new Date(now+delay).toISOString()};
}

async function execute(db:ReturnType<typeof workerDb>,job:AiJob){
 const {data:client,error}=await db.from("clients").select("owner_id,knowledge_revision")
    .eq("id",job.client_id).maybeSingle();
 dbError(error,"Il worker non può leggere il cliente");
 if(!client||client.owner_id!==job.requested_by)
   throw new ApiFailure(403,"Lavoro non autorizzato: proprietario differente");
 // The service role bypasses RLS; NEVER run a job without this ownership check.
 const ctx={db,user:{id:job.requested_by}} as unknown as Context;
 if(job.kind==="dossier"){
   if(Object.keys(job.payload).length)throw new ApiFailure(400,"Payload dossier non valido");
   const dossier=await draftDossier(ctx,job.client_id,job.id);
   await audit(ctx,job.client_id,"dossier_generated",dossier.id,{job_id:job.id});
   return {dossier_id:dossier.id,version:dossier.version};
 }
 const input=missionSchema.safeParse(job.payload);
 if(!input.success)throw new ApiFailure(400,"Parametri della missione non validi");
 const all=await contextForAI(ctx,job.client_id);
 if(all.dossier?.status!=="approved"||all.dossier.knowledge_revision!==all.client.knowledge_revision)
   throw new ApiFailure(409,"Approva un dossier aggiornato prima di avviare gli agenti");
 if(input.data.offer_id&&!all.offers.some(o=>o.id===input.data.offer_id))
   throw new ApiFailure(409,"L'offerta deve essere verificata per questo cliente");
 // The unique ai_job_id makes worker retries idempotent across crashes.
 const {data:prior,error:priorError}=await db.from("missions")
   .select("id,status,payload").eq("ai_job_id",job.id).eq("client_id",job.client_id).maybeSingle();
 dbError(priorError);
 if(prior?.status==="proposed"||prior?.status==="approved")
   return {mission_id:prior.id,proposal_title:"Proposta già disponibile"};
 let missionId=prior?.id;
 if(missionId){
   const reset=await db.from("missions").update({
     status:"running",error:null,updated_at:new Date().toISOString()
   }).eq("id",missionId).eq("client_id",job.client_id);
   dbError(reset.error,"Impossibile riprendere la missione");
 }else{
   const {data:mission,error:missionErr}=await db.from("missions").insert({
     client_id:job.client_id,request:input.data.request,status:"running",ai_job_id:job.id
   }).select("id").single();
   dbError(missionErr,"Impossibile creare la missione");
   missionId=mission.id;
 }
 const output=await executeMission(ctx,job.client_id,missionId!,input.data.request,
   input.data.period,input.data.offer_id??null);
 await audit(ctx,job.client_id,"mission_proposed",missionId!,{job_id:job.id});
 await db.from("messages").insert({
   client_id:job.client_id,role:"leader",
   body:"Il team ha completato la missione: «"+output.payload.campaign.title+"». "+
     "Apri il riquadro della proposta per verificare e approvare i contenuti.",
   metadata:{kind:"campaign_proposal",mission_id:missionId,job_id:job.id}
 });
 return {mission_id:missionId!,proposal_title:output.payload.campaign.title};
}

export async function processNextJob(){
 const db=workerDb();
 const claimed=await db.rpc("forgecy_claim_ai_job");
 dbError(claimed.error,"Impossibile riservare un lavoro");
 const raw=claimed.data?.[0];
 if(!raw)return {processed:false};
 const parsed=jobSchema.safeParse(raw);
 if(!parsed.success)throw new ApiFailure(500,"Il worker ha ricevuto un lavoro non valido");
 const job=parsed.data;
 try {
   const result=await execute(db,job);
   const finished=await db.from("ai_jobs").update({
     status:"succeeded",result,error:null,locked_until:null,finished_at:new Date().toISOString(),
     updated_at:new Date().toISOString()
   }).eq("id",job.id).eq("status","running").eq("attempts",job.attempts).select("id").maybeSingle();
   dbError(finished.error,"Risultato del lavoro non salvato");
   if(!finished.data)throw new ApiFailure(409,"Il worker ha perso la proprietà del lavoro");
   return {processed:true,job_id:job.id,status:"succeeded",kind:job.kind};
 }catch(err){
   const fatal=err instanceof ApiFailure && err.status<500;
   const policy=nextFailure(job,fatal);
   const message=(err instanceof Error?err.message:"Errore sconosciuto").slice(0,400);
   // An expired/competing worker must not overwrite a newer attempt.
   const {error}=await db.from("ai_jobs").update({
     status:policy.retry?"queued":"failed",
     error:message,run_after:policy.run_after,locked_until:null,
     finished_at:policy.retry?null:new Date().toISOString(),updated_at:new Date().toISOString()
   }).eq("id",job.id).eq("status","running").eq("attempts",job.attempts);
   dbError(error,"Impossibile salvare il fallimento del lavoro");
   return {processed:true,job_id:job.id,status:policy.retry?"retry":"failed",kind:job.kind};
 }
}
