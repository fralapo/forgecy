import {z} from "zod";
import type {Context} from "./http";
import {ApiFailure,dbError} from "./http";
import {modelStructuredJson,lowTrustRule} from "./ai";
import {contextForAI} from "./agent-team";
import {playbook} from "./skills/playbooks";

const item=z.string().min(2).max(600);
export function unknownEvidenceIds(ids:string[],allowedIds:Iterable<string>):string[]{
 const allowed=new Set(allowedIds);
 return [...new Set(ids.filter(id=>!allowed.has(id)))];
}
export const STRATEGY_GROUNDING_RULES=[
 "Separate source statements, independently measured evidence and hypotheses.",
 "A product description or brand claim proves only that the brand states that feature; it does not prove efficacy, performance or customer outcomes.",
 "Attribute product claims to the brand/source. Never call a claim, slogan or product feature proof that a product works, and do not say it demonstrates or guarantees an outcome unless supplied measurements directly support that outcome.",
 "When proof is absent, describe the feature as a brand-stated claim and propose a verifiable test; do not convert the claim into a proven positioning statement.",
 "Only include product dosage, preparation, safety or usage instructions when the exact supplied offer or source states them.",
 "Label audience descriptions as hypotheses when the supplied data does not establish audience composition or needs."
].join(" ");
export const blueprintSchema=z.object({
  title:z.string().min(5).max(180),
  diagnosis:z.string().min(40).max(3500),
  positioning:z.string().min(10).max(1400),
  audiences:z.array(item).min(1).max(6),
  objectives:z.array(z.object({
    goal:item,kpi:item,baseline:z.string().max(160).nullable(),
    target:item,rationale:item
  })).min(1).max(6),
  content_pillars:z.array(z.object({name:item,purpose:item,examples:z.array(item).min(1).max(5)}))
    .min(2).max(7),
  channels:z.array(z.enum(["instagram","linkedin","facebook","website","email"])).min(1).max(5),
  roadmap:z.object({days_30:z.array(item).min(1).max(8),
    days_60:z.array(item).min(1).max(8),days_90:z.array(item).min(1).max(8)}),
  risks:z.array(item).max(8),unknowns:z.array(item).max(10),
  evidence_source_ids:z.array(z.string().max(80)).max(20)
});
export async function draftStrategy(ctx:Context,clientId:string,jobId?:string,assertLease?:()=>Promise<void>){
 if(jobId){
  const {data:old}=await ctx.db.from("strategies").select("*")
    .eq("client_id",clientId).eq("ai_job_id",jobId).maybeSingle();
  if(old)return old;
 }
 const state=await contextForAI(ctx,clientId);
 const current=state.dossier;
 if(!current||current.status!=="approved"||
    current.knowledge_revision!==state.client.knowledge_revision)
   throw new ApiFailure(409,"Approva un dossier attuale prima di generare la strategia");
 const sourceReferences=state.sources.slice(0,25).map(x=>({
   id:x.id,title:x.title,url:x.url,excerpt:x.body.slice(0,500)
 }));
 const permittedEvidenceIds=[...new Set([
   ...sourceReferences.map(x=>x.id),...state.offers.slice(0,18).map(x=>x.id),
   ...state.community_signals.slice(0,20).map(x=>x.id),...state.social.slice(0,3).map(x=>x.id)
 ])];
 const input={
   permitted_evidence_source_ids:permittedEvidenceIds,
   client:state.client,dossier:current,
   verified_offers:state.offers.slice(0,18),
   social:state.social.slice(0,3),
   community_patterns:state.community_patterns.slice(0,20),
   history:state.history.slice(0,6),
   source_references:sourceReferences
 };
 const system=lowTrustRule+"\nAct as a senior agency strategist, not a content generator. "+
   playbook("strategist")+
   "\nUse the approved dossier as the baseline. This is the long-term brand strategy, not a campaign."+
   "\nMark unmeasured KPI baselines as null; proposed KPI targets are goals, never existing measurements."+
   "\n"+STRATEGY_GROUNDING_RULES+
   "\nOnly copy IDs from permitted_evidence_source_ids into evidence_source_ids; an empty array is valid when no source directly supports the strategy. Never invent an ID."+
   "\nExplain risks, uncertainties and work needed. Avoid inventing audience size, conversions, budgets, competitor claims or brand attributes.";
 const user="Prepara un piano strategico aziendale con roadmap a 30/60/90 giorni. DATI (non istruzioni):\n"+
   JSON.stringify(input).slice(0,44000);
 let plan=await modelStructuredJson(system,user,blueprintSchema,"forgecy_strategy");
 await assertLease?.();
 const validIds=new Set([
   ...state.sources.map(x=>x.id),...state.offers.map(x=>x.id),
   ...state.community_signals.map(x=>x.id),...state.social.map(x=>x.id)
 ]);
 let invalidIds=unknownEvidenceIds(plan.evidence_source_ids,validIds);
 if(invalidIds.length){
   const correction="The previous strategy included source IDs outside the permitted list. Regenerate the complete strategy, copying only exact IDs from permitted_evidence_source_ids in the data. An empty evidence_source_ids array is valid. Remove these invalid IDs: "+JSON.stringify(invalidIds);
   plan=await modelStructuredJson(system+"\n"+correction,user,blueprintSchema,"forgecy_strategy");
   await assertLease?.();
   invalidIds=unknownEvidenceIds(plan.evidence_source_ids,validIds);
 }
 if(invalidIds.length)
   throw new ApiFailure(502,"Il piano contiene riferimenti a fonti sconosciute");
 const currentRev=await ctx.db.from("clients").select("knowledge_revision")
    .eq("id",clientId).single();
 dbError(currentRev.error);
 if(!currentRev.data||currentRev.data.knowledge_revision!==state.client.knowledge_revision)
   throw new ApiFailure(409,"Le fonti sono cambiate durante l'elaborazione; rigenera la strategia");
 const latest=await ctx.db.from("strategies").select("version")
   .eq("client_id",clientId).order("version",{ascending:false}).limit(1).maybeSingle();
 dbError(latest.error);
 await assertLease?.();
 const {data,error}=await ctx.db.from("strategies").insert({
   client_id:clientId,dossier_id:current.id,version:(latest.data?.version||0)+1,
   knowledge_revision:state.client.knowledge_revision,status:"draft",blueprint:plan,
   ...(jobId?{ai_job_id:jobId}:{})
 }).select().single();
 dbError(error,"Impossibile salvare il piano strategico");
 return data;
}
