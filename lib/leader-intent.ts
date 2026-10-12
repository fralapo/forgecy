import { z } from "zod";
import type { Context } from "./http";
import { ApiFailure,dbError } from "./http";
import { lowTrustRule,modelJson } from "./ai";
import { contextForAI,draftDossier,executeMission,answerLeader } from "./agent-team";
import { signalSchema } from "./schemas";

const intentSchema=z.object({
 action:z.enum(["answer","campaign","dossier","signal"]),
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
   const dossier=await draftDossier(ctx,clientId);
   return {
    body:"Ho preparato una nuova bozza del dossier aziendale (versione "+dossier.version+
     "). Apri Biblioteca → Analisi aziendale per verificare le fonti e approvarla. Nessuna strategia è stata applicata automaticamente.",
    metadata:{kind:"dossier_draft",dossier_id:dossier.id}
   };
 }
 if(intent.action==="campaign"){
   if(context.dossier?.status!=="approved")
    return {body:"Posso coordinare questa campagna, ma prima serve un dossier aziendale attuale e approvato. Apri Biblioteca → Analisi aziendale e completalo. Non avvio la produzione su informazioni non verificate.",metadata:{kind:"blocked_missing_dossier"}};
   if(intent.offer_id && !offers.some(o=>o.id===intent.offer_id))
    throw new ApiFailure(409,"L'offerta scelta non è verificata per questo cliente");
   // If a commercial objective mentions a product that is not explicitly matched,
   // do not produce a misleading generic campaign.
   if(intent.offer_id===null && offers.length>0 && /(promuov|vend|lanci|campagna commerciale)/i.test(body))
    return {
      body:"Ho riconosciuto l'obiettivo commerciale, ma non ho identificato con certezza il prodotto o servizio. Specifica quale offerta verificata intendi promuovere: "+offers.map(o=>o.name).join(", ")+".",
      metadata:{kind:"offer_clarification"}
    };
   const {data:mission,error}=await ctx.db.from("missions").insert({
    client_id:clientId,status:"running",request:intent.objective||body
   }).select().single();
   dbError(error,"Non è stato possibile avviare il team");
   const result=await executeMission(ctx,clientId,mission.id,intent.objective||body,intent.period,intent.offer_id);
   const camp=result.payload.campaign;
   return {
    body:"Ho coordinato Analyst, Strategist, Copywriter/Art Director e Brand Guard. "+
     "La proposta «"+camp.title+"» per "+intent.period+
     " è pronta. Puoi controllare i passaggi degli agenti e approvarla qui in chat: non ho ancora creato la campagna.",
    metadata:{kind:"campaign_proposal",mission_id:mission.id}
   };
 }
 return {body:await answerLeader(ctx,clientId,body),metadata:{kind:"answer"}};
}
