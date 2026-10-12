import { z } from "zod";
import type { Context } from "./http";
import { ApiFailure,dbError } from "./http";
import { lowTrustRule,modelJson } from "./ai";
import { contextForAI,answerLeader } from "./agent-team";
import { signalSchema } from "./schemas";

const intentSchema=z.object({
 action:z.enum(["answer","campaign","dossier","strategy","signal"]),
 signal:signalSchema.nullable().optional(),
 objective:z.string().max(2500).default(""),
 period:z.string().max(80).default("Prossimi 30 giorni"),
 offer_id:z.uuid().nullable().default(null)
});
export async function handleLeaderMessage(ctx:Context,clientId:string,body:string){
 const context=await contextForAI(ctx,clientId);
 const offers=context.offers.map(o=>({id:o.id,name:o.name,kind:o.kind}));
 const {data:history}=await ctx.db.from("messages").select("role,body").eq("client_id",clientId).order("created_at",{ascending:false}).limit(12);
 const recent=(history||[]).reverse().map(m=>({role:m.role,body:String(m.body).slice(0,1700)}));
 const intent=await modelJson(
  lowTrustRule+"\nYou are the routing coordinator. Classify the USER request only. "+
  "Choose campaign when user asks to CREATE a strategy, promotional campaign, content plan or post series. "+
  "Choose dossier when user asks for an initial or updated company analysis. "+
  "Choose strategy when user asks for the overall company positioning, strategic plan, goals, KPI and 30/60/90-day direction; NOT for a particular campaign. "+
  "Choose signal ONLY for an explicit command to register an anonymized community question, objection, review or feedback. Return a proposed signal with valid type/platform and source details only if supplied; otherwise leave source_url null. "+
  "Choose answer for questions, greetings, explanations or edits that cannot be executed through supported operations. "+
  "Do not invent offer IDs; choose an exact ID only when clearly matched. "+
  "Consider the previous client-scoped conversation: if the user specifies an offer after a campaign clarification, recover the original objective and month. "+
  "Never pretend a task was executed. Return short objective and explicit period.",
  "CRONOLOGIA CHAT JSON:\n"+JSON.stringify(recent).slice(0,16000)+"\nUtente chiede ora: "+body+"\nProdotti/servizi VERIFICATI JSON: "+JSON.stringify(offers)+
    "\nDossier attuale: "+(context.dossier?.status||"assente")+
    "\nPeriodo corrente: "+new Date().toISOString().slice(0,10),
  intentSchema
 );
 if(intent.action==="signal"){
   if(!/(registr|annot|aggiung|salva|segnala)/i.test(body)||!intent.signal){
     return {body:"Posso preparare un'osservazione per la Biblioteca. Dimmi quale domanda, obiezione o feedback vuoi registrare, senza nomi o dati personali.",metadata:{kind:"answer"}};
   }
   return {
     body:"Ho preparato un feedback della community sul tema «"+intent.signal.topic+"». Controllalo e conferma prima di inserirlo nella Biblioteca: non è ancora stato salvato.",
     metadata:{kind:"signal_proposal",signal:intent.signal}
   };
 }
 if(intent.action==="dossier"){
   const queued=await ctx.db.rpc("forgecy_enqueue_ai_job",{
     p_client_id:clientId,p_kind:"dossier",p_payload:{}
   });
   dbError(queued.error,"Non posso accodare l'analisi: verifica il limite di lavori del cliente");
   return {
     body:"Ho accodato l'analisi aziendale. Gli agenti lavoreranno sulle fonti attuali e troverai il dossier in Biblioteca al termine. Non è ancora stato generato né approvato.",
     metadata:{kind:"job_queued",job_id:queued.data}
   };
 }
 if(intent.action==="strategy"){
   if(context.dossier?.status!=="approved")
     return {body:"Il piano strategico deve partire da un dossier aziendale aggiornato e approvato. Completa prima l'analisi.",metadata:{kind:"blocked_missing_dossier"}};
   const queued=await ctx.db.rpc("forgecy_enqueue_ai_job",{
     p_client_id:clientId,p_kind:"strategy",p_payload:{}
   });
   dbError(queued.error,"Il piano strategico non può essere accodato");
   return {body:"Ho accodato la preparazione del piano strategico aziendale. Sarà una bozza da esaminare in Biblioteca → Strategia prima di usarla per le campagne.",metadata:{kind:"job_queued",job_id:queued.data}};
 }
 if(intent.action==="campaign"){
   if(context.dossier?.status!=="approved")
    return {body:"Posso coordinare questa campagna, ma prima serve un dossier aziendale attuale e approvato. Apri Biblioteca → Analisi aziendale e completalo. Non avvio la produzione su informazioni non verificate.",metadata:{kind:"blocked_missing_dossier"}};
   if(context.strategy?.status!=="approved"||context.strategy.knowledge_revision!==context.client.knowledge_revision)
     return {body:"Prima approva il piano strategico aggiornato in Biblioteca → Strategia: le campagne devono rispettare una direzione aziendale validata.",metadata:{kind:"blocked_missing_strategy"}};
   if(intent.offer_id && !offers.some(o=>o.id===intent.offer_id))
    throw new ApiFailure(409,"L'offerta scelta non è verificata per questo cliente");
   // If a commercial objective mentions a product that is not explicitly matched,
   // do not produce a misleading generic campaign.
   if(intent.offer_id===null && offers.length>0 && /(promuov|vend|lanci|campagna commerciale)/i.test(body))
    return {
      body:"Ho riconosciuto l'obiettivo commerciale, ma non ho identificato con certezza il prodotto o servizio. Specifica quale offerta verificata intendi promuovere: "+offers.map(o=>o.name).join(", ")+".",
      metadata:{kind:"offer_clarification"}
    };
   const queued=await ctx.db.rpc("forgecy_enqueue_ai_job",{
     p_client_id:clientId,p_kind:"mission",
     p_payload:{request:intent.objective||body,period:intent.period,offer_id:intent.offer_id}
   });
   dbError(queued.error,"Missione non accodata: verifica limiti e configurazione");
   return {
     body:"Ho affidato l'obiettivo alla coda del Leader. Analyst, Strategist, Creative e Brand Guard elaboreranno la proposta. Comparirà in chat quando completa; nessuna campagna è stata approvata.",
     metadata:{kind:"job_queued",job_id:queued.data}
   };
 }
 return {body:await answerLeader(ctx,clientId,body),metadata:{kind:"answer"}};
}
