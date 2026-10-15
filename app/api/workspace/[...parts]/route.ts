import { z } from "zod";
import { auth,requireClient,read,json,fail,ApiFailure,dbError,audit } from "@/lib/http";
import { clientSchema,sourceSchema,offerSchema,campaignSchema,missionSchema,chatSchema,updateContentSchema,signalSchema } from "@/lib/schemas";
import { draftDossier,executeMission,contextForAI } from "@/lib/agent-team";
import { handleLeaderMessage } from "@/lib/leader-intent";
import { modelJson,lowTrustRule } from "@/lib/ai";
import {withAiUsageScope} from "@/lib/ai-usage";
import { crawlWebsite, publicHttpsUrl } from "@/lib/site-ingest";
import { requireWebsiteCrawlingEnabled, reserveWebsiteCrawl } from "@/lib/crawl-budget";
import { extractDocument } from "@/lib/document-extract";
import { assertSafeDocument, DocumentSafetyError } from "@/lib/document-safety";
import { readMultipartForm } from "@/lib/request-body";
import { slidePreflight } from "@/lib/carousel-layout";

export const runtime="nodejs";
export const maxDuration=120;
type Params={params:Promise<{parts:string[]}>};

const uuid=z.uuid();
function validId(value:string|undefined){
 if(!value || !uuid.safeParse(value).success) throw new ApiFailure(400,"Identificativo non valido");
 return value;
}
async function list(ctx:Awaited<ReturnType<typeof auth>>,id:string){
 const selections=[
  ["sources","*"],["community_signals","*"],["offers","*"],["dossiers","*"],["campaigns","*"],
  ["contents","*"],["messages","*"],["missions","*"],["agent_events","*"],["ai_jobs","id,client_id,requested_by,kind,payload,status,result,error,attempts,max_attempts,run_after,locked_until,created_at,updated_at,finished_at"],["strategies","*"],["editorial_entries","*"],
  ["social_snapshots","*"],["social_accounts","id,client_id,platform,remote_id,username,token_expires_at,needs_reauth,created_at"]
 ] as const;
 const results=await Promise.all(selections.map(async ([table,fields])=>{
   const {data,error}=await ctx.db.from(table).select(fields).eq("client_id",id).order(table==="social_snapshots"?"collected_at":"created_at",{ascending:false}).limit(150);
   if(error && table==="social_snapshots"){ // social_snapshots has collected_at, not created_at
     const retry=await ctx.db.from(table).select(fields).eq("client_id",id).order("collected_at",{ascending:false}).limit(100);
     return [table,retry.data||[]] as const;
   }
   if(error && table==="social_accounts") throw new ApiFailure(500,"Impossibile leggere i collegamenti social");
   if(error) throw new ApiFailure(500,"Impossibile leggere "+table);
   return [table,data||[]] as const;
 }));
 const all:Record<string,unknown>={};results.forEach(([table,items])=>all[table]=items);
 return all;
}
export async function GET(request:Request,{params}:Params){
 try {
  const p=(await params).parts;
  const ctx=await auth();
  if(p.length===1 && p[0]==="clients"){
   const {data,error}=await ctx.db.from("clients").select("id,name,industry,website,profile,knowledge_revision,created_at,updated_at").order("created_at",{ascending:false});
   dbError(error,"Impossibile leggere i clienti");return json({clients:data||[]});
  }
  if(p[0]!=="clients") throw new ApiFailure(404,"Risorsa non disponibile");
  const id=validId(p[1]),client=await requireClient(ctx,id);
  if(p.length===2) return json({client,...await list(ctx,id)});
  if(p.length===4 && p[2]==="sources"){
   const sourceId=validId(p[3]);
   const {data,error}=await ctx.db.from("sources").select("*").eq("id",sourceId).eq("client_id",id).maybeSingle();
   dbError(error);if(!data)throw new ApiFailure(404,"Fonte non trovata");
   return json({source:data});
  }
  if(p.length===3 && p[2]==="context") return json({context:await contextForAI(ctx,id)});
  if(p.length===3 && p[2]==="assets"){
   const path=new URL(request.url).searchParams.get("path")||"";
   if(!path.startsWith(id+"/") || path.includes("..")) throw new ApiFailure(403,"Percorso non autorizzato");
   const {data,error}=await ctx.db.storage.from("forgecy-assets").createSignedUrl(path,120);
   dbError(error,"Impossibile firmare il file");
   return json({url:data?.signedUrl});
  }
  void client;throw new ApiFailure(404,"Risorsa non trovata");
 }catch(e){return fail(e)}
}
export async function POST(request:Request,{params}:Params){
 try {
  const p=(await params).parts,ctx=await auth();
  if(p.length===1 && p[0]==="clients"){
   const input=await read(request,clientSchema);
   const {data,error}=await ctx.db.from("clients").insert({...input,owner_id:ctx.user.id}).select().single();
   dbError(error,"Impossibile creare il cliente");
   return json({client:data},201);
  }
  if(p[0]!=="clients") throw new ApiFailure(404,"Risorsa non trovata");
  const id=validId(p[1]);await requireClient(ctx,id);
  if(p.length===3 && p[2]==="sources"){
   const input=await read(request,sourceSchema);
   const {data,error}=await ctx.db.from("sources").insert({...input,client_id:id,status:"ready",captured_at:new Date().toISOString()}).select().single();
   dbError(error,"Impossibile salvare la fonte");
   await audit(ctx,id,"source_created",data.id);
   return json({source:data},201);
  }
  if(p.length===3 && p[2]==="signals"){
   const input=await read(request,signalSchema);
   const {data,error}=await ctx.db.from("community_signals").insert({...input,client_id:id}).select().single();
   dbError(error,"Impossibile registrare il feedback");
   await audit(ctx,id,"community_signal_created",data.id);
   return json({signal:data},201);
  }
  if(p.length===3 && p[2]==="website"){
   const input=await read(request,z.object({
     url:z.url(),maxPages:z.number().int().min(1).max(6).default(5)
   }));
   requireWebsiteCrawlingEnabled();
   let hostname:string;
   try {hostname=publicHttpsUrl(input.url).hostname;}
   catch {throw new ApiFailure(400,"Inserisci un sito HTTPS pubblico valido");}
   // Reservation is atomic across instances; a failed DB check must block crawling.
   const reservationId=await reserveWebsiteCrawl(ctx,id,hostname,input.maxPages);
   const result=await crawlWebsite(input.url,input.maxPages);
   const {data:previous,error:priorError}=await ctx.db.from("sources")
     .select("id,url,content_sha256").eq("client_id",id).eq("kind","website");
   dbError(priorError,"Impossibile verificare le fonti web esistenti");
   const byUrl=new Map((previous||[]).map(row=>[row.url,row]));
   const imported:unknown[]=[];
   let unchanged=0;
   for(const page of result.pages){
     const existing=byUrl.get(page.url);
     if(existing?.content_sha256===page.contentSha256){unchanged++;continue;}
     const record={
       client_id:id,kind:"website",title:page.title||page.url,url:page.url,
       body:[page.description,page.body].filter(Boolean).join("\n"),
       status:"ready",captured_at:page.capturedAt,
       content_sha256:page.contentSha256,
       source_metadata:{source:"public_html",root_url:input.url,crawler:"ForgecyResearch/1.0"}
     };
     const write=existing
       ?ctx.db.from("sources").update(record).eq("id",existing.id).eq("client_id",id).select().single()
       :ctx.db.from("sources").insert(record).select().single();
     const {data,error}=await write;
     dbError(error,"Errore durante il salvataggio della pagina web");
     imported.push(data);
   }
   await audit(ctx,id,"website_crawl_finished",undefined,{
     domain:hostname,reservationId,imported:imported.length,unchanged,
     skipped:result.skipped.length,pages:result.pages.length
   });
   return json({source:imported[0]||null,sources:imported,unchanged,
     visited:result.pages.length,skipped:result.skipped,
     message:imported.length?"Fonti web acquisite. Rivedi il dossier prima dell'approvazione.":"Nessun cambiamento alle pagine già registrate."
   },imported.length?201:200);
  }
  if(p.length===3 && p[2]==="offers"){
   const input=await read(request,offerSchema);
   const {data,error}=await ctx.db.from("offers").insert({...input,client_id:id}).select().single();
   dbError(error,"Impossibile creare l'offerta");
   await audit(ctx,id,"offer_created",data.id);
   return json({offer:data},201);
  }
  if(p.length===4 && p[2]==="dossier" && p[3]==="draft"){
   const dossier=await withAiUsageScope({clientId:id,requestedBy:ctx.user.id,operation:"dossier"},()=>draftDossier(ctx,id));
   await audit(ctx,id,"dossier_generated",dossier.id);
   return json({dossier},201);
  }
  if(p.length===4 && p[2]==="dossier" && p[3]==="approve"){
   const input=await read(request,z.object({dossier_id:uuid}));
   const {data,error}=await ctx.db.rpc("approve_forgecy_dossier",{p_client_id:id,p_dossier_id:input.dossier_id});
   dbError(error,"Dossier non aggiornato o non approvabile");
   return json({approved:data});
  }
  if(p.length===3 && p[2]==="campaigns"){
   const input=await read(request,campaignSchema);
   const ctxAI=await contextForAI(ctx,id);
   if(ctxAI.dossier?.status!=="approved")throw new ApiFailure(409,"Approva prima il dossier aziendale");
   if(ctxAI.strategy?.status!=="approved"||ctxAI.strategy.knowledge_revision!==ctxAI.client.knowledge_revision)
     throw new ApiFailure(409,"Approva prima la strategia aziendale aggiornata");
   if(ctxAI.strategy?.status!=="approved"||ctxAI.strategy.knowledge_revision!==ctxAI.client.knowledge_revision)
     throw new ApiFailure(409,"Approva prima il piano strategico aggiornato");
   if(input.offer_id && !ctxAI.offers.some(o=>o.id===input.offer_id)) throw new ApiFailure(409,"L'offerta deve essere verificata");
   const {data,error}=await ctx.db.from("campaigns").insert({...input,client_id:id,status:"draft"}).select().single();
   dbError(error,"Campagna non creata");await audit(ctx,id,"campaign_created",data.id);
   return json({campaign:data},201);
  }
  if(p.length===3 && p[2]==="missions"){
   const input=await read(request,missionSchema);
   const context=await contextForAI(ctx,id);
   if(context.dossier?.status!=="approved")throw new ApiFailure(409,"Approva un dossier attuale prima di affidare una campagna agli agenti");
   if(context.strategy?.status!=="approved"||context.strategy.knowledge_revision!==context.client.knowledge_revision)
     throw new ApiFailure(409,"Approva prima il piano strategico attuale");
   if(input.offer_id && !context.offers.some(o=>o.id===input.offer_id))throw new ApiFailure(409,"Offerta non confermata");
   const {data,error}=await ctx.db.from("missions").insert({client_id:id,request:input.request,status:"running"}).select().single();
   dbError(error,"Missione non avviata");
   const result=await withAiUsageScope({clientId:id,requestedBy:ctx.user.id,operation:"mission"},()=>executeMission(ctx,id,data.id,input.request,input.period,input.offer_id||null));
   await audit(ctx,id,"mission_proposed",data.id);
   return json({mission_id:data.id,...result},201);
  }
  if(p.length===5 && p[2]==="missions" && p[4]==="approve"){
   const missionId=validId(p[3]);
   const {data,error}=await ctx.db.rpc("approve_forgecy_mission",{p_client_id:id,p_mission_id:missionId});
   dbError(error,"La proposta non può essere approvata; verifica il dossier");
   return json({campaign_id:data});
  }
  if(p.length===5 && p[2]==="missions" && p[4]==="reject"){
   const missionId=validId(p[3]);
   const {data,error}=await ctx.db.from("missions").update({status:"rejected"}).eq("id",missionId).eq("client_id",id).eq("status","proposed").select("id").maybeSingle();
   dbError(error);if(!data)throw new ApiFailure(409,"Proposta non disponibile");
   await audit(ctx,id,"mission_rejected",missionId);return json({rejected:true});
  }
  if(p.length===3 && p[2]==="messages"){
   const input=await read(request,chatSchema);
   const {error}=await ctx.db.from("messages").insert({client_id:id,role:"user",body:input.body});
   dbError(error,"Messaggio non inviato");
   const result=await withAiUsageScope({clientId:id,requestedBy:ctx.user.id,operation:"chat"},()=>handleLeaderMessage(ctx,id,input.body));
   const saved=await ctx.db.from("messages").insert({client_id:id,role:"leader",body:result.body,metadata:result.metadata}).select().single();
   dbError(saved.error,"Risposta non salvata");return json({message:saved.data});
  }
  if(p.length===5 && p[2]==="contents" && p[4]==="revalidate"){
   const contentId=validId(p[3]);
   const {data:current,error:currentError}=await ctx.db.from("contents").select("id,status,offer_id,parent_id,revision").eq("id",contentId).eq("client_id",id).maybeSingle();
   dbError(currentError);if(!current)throw new ApiFailure(404,"Contenuto non trovato");
   if(current.status!=="stale")throw new ApiFailure(409,"Solo i contenuti da aggiornare possono essere revisionati");
   let offer_version:number|null=null,source_revision:number|null=null;
   if(current.offer_id){
     const {data:offer}=await ctx.db.from("offers").select("status,version").eq("client_id",id).eq("id",current.offer_id).maybeSingle();
     if(!offer||offer.status!=="verified")throw new ApiFailure(409,"Verifica prima l'offerta collegata");
     offer_version=offer.version;
   }
   if(current.parent_id){
     const {data:original}=await ctx.db.from("contents").select("status,revision").eq("client_id",id).eq("id",current.parent_id).maybeSingle();
     if(!original||original.status==="stale")throw new ApiFailure(409,"Aggiorna prima l'originale Instagram");
     source_revision=original.revision;
   }
   const {data,error}=await ctx.db.from("contents").update({status:"draft",offer_version,source_revision}).eq("id",contentId).eq("client_id",id).eq("revision",current.revision).select().maybeSingle();
   dbError(error);if(!data)throw new ApiFailure(409,"Versione modificata: aggiorna la pagina");
   await audit(ctx,id,"content_revalidated",contentId);
   return json({content:data});
  }
  if(p.length===5 && p[2]==="contents" && p[4]==="adapt"){
   const contentId=validId(p[3]);
   const {data:original,error}=await ctx.db.from("contents").select("*").eq("id",contentId).eq("client_id",id).maybeSingle();
   dbError(error);
   if(!original||original.channel!=="instagram"||original.status==="stale")throw new ApiFailure(409,"Apri un contenuto Instagram valido");
   const docFormat=original.format==="carousel"?"document":"post";
   const schema=z.object({title:z.string().min(1).max(240),caption:z.string().max(12000),
    slides:z.array(z.object({headline:z.string().max(240),body:z.string().max(1000),visual_prompt:z.string().max(1000).optional()})).max(20)});
   const revised=await withAiUsageScope({clientId:id,requestedBy:ctx.user.id,operation:"adapt"},()=>modelJson(lowTrustRule+"\nRole: LinkedIn editor. Reframe an Instagram asset for LinkedIn professionals; not just a literal translation. Output professional copy and document pages when original carousel. No unsupported claims.",
      "ORIGINALE JSON:\n"+JSON.stringify(original).slice(0,24000),schema));
   const {data,error:writeError}=await ctx.db.from("contents").insert({
    client_id:id,campaign_id:original.campaign_id,offer_id:original.offer_id,offer_version:original.offer_version,
    parent_id:original.id,source_revision:original.revision,
    channel:"linkedin",format:docFormat,title:revised.title,caption:revised.caption,
    slides:docFormat==="document"?revised.slides:[],status:"draft"
   }).select().single();
   dbError(writeError,"Adattamento non salvato");await audit(ctx,id,"linkedin_adapted",data.id,{source:contentId});
   return json({content:data},201);
  }
  if(p.length===3 && p[2]==="contents"){
   const input=await read(request,z.object({
     campaign_id:uuid,channel:z.enum(["instagram","linkedin"]),
     format:z.enum(["post","carousel","document"]),title:z.string().min(1).max(240),
     caption:z.string().max(12000).default(""),offer_id:uuid.nullable().optional()
   }).refine(v=>v.channel==="instagram"?(v.format==="post"||v.format==="carousel"):(v.format==="post"||v.format==="document"),"Formato non disponibile per questo canale"));
   const {data:campaign}=await ctx.db.from("campaigns").select("id").eq("client_id",id).eq("id",input.campaign_id).maybeSingle();
   if(!campaign)throw new ApiFailure(404,"Campagna non trovata");
   const {data,error}=await ctx.db.from("contents").insert({...input,client_id:id,slides:[],status:"draft"}).select().single();
   dbError(error);return json({content:data},201);
  }
  if(p.length===5 && p[2]==="sources" && p[4]==="process"){
   const sourceId=validId(p[3]);
   const {data:source,error:sourceError}=await ctx.db.from("sources").select("id,title,kind,file_path,status").eq("id",sourceId).eq("client_id",id).maybeSingle();
   dbError(sourceError);if(!source||source.kind!=="document"||!source.file_path)
    throw new ApiFailure(404,"Documento non trovato");
   if(!source.file_path.startsWith(id+"/")||source.file_path.includes(".."))
    throw new ApiFailure(403,"Percorso documento non valido");
   const {data:file,error:storageError}=await ctx.db.storage.from("forgecy-sources").download(source.file_path);
   dbError(storageError,"Non è possibile leggere il documento");
   if(!file||file.size>10_000_000)throw new ApiFailure(413,"Documento troppo grande");
   const extraction=await extractDocument(new Uint8Array(await file.arrayBuffer()),file.type||"",source.title);
   const {data,error}=await ctx.db.from("sources").update({
    ...extraction,captured_at:extraction.status==="ready"?new Date().toISOString():null
   }).eq("id",sourceId).eq("client_id",id).select().maybeSingle();
   dbError(error);if(!data)throw new ApiFailure(404,"Documento non trovato");
   await audit(ctx,id,"document_reprocessed",sourceId,{status:extraction.status});
   return json({source:data,extracted:extraction.status==="ready"});
  }
  if(p.length===3 && p[2]==="upload"){
   const form=await readMultipartForm(request,11_000_000),file=form.get("file");
   if(!(file instanceof File))throw new ApiFailure(400,"Seleziona un file");
   if(file.size>10_000_000||file.size===0)throw new ApiFailure(413,"Dimensione non valida");
   const allowed=["text/plain","text/markdown","text/csv","application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","image/png","image/jpeg","image/webp"];
   if(!allowed.includes(file.type))throw new ApiFailure(415,"Formato file non supportato");
   const safeName=file.name.replace(/[^a-z0-9._-]/gi,"_").slice(0,90);
   const path=id+"/"+crypto.randomUUID()+"/"+safeName;
   const bytes=new Uint8Array(await file.arrayBuffer());
   // Reject malformed archives and spoofed files before private Storage receives them.
   try { assertSafeDocument(bytes,file.type,file.name); }
   catch(error){
     if(error instanceof DocumentSafetyError)throw new ApiFailure(415,error.message);
     throw error;
   }
   const uploaded=await ctx.db.storage.from("forgecy-sources").upload(path,bytes,{contentType:file.type,upsert:false});
   dbError(uploaded.error,"Caricamento non riuscito");
   const extraction=await extractDocument(bytes,file.type,file.name);
   const {data,error}=await ctx.db.from("sources").insert({
    client_id:id,kind:"document",title:file.name,file_path:path,...extraction,
    captured_at:extraction.status==="ready"?new Date().toISOString():null
   }).select().single();
   if(error){await ctx.db.storage.from("forgecy-sources").remove([path]);dbError(error);}
   await audit(ctx,id,"document_uploaded",data.id,{status:extraction.status});
   return json({source:data,extracted:extraction.status==="ready",message:extraction.error},201);
  }
  throw new ApiFailure(404,"Comando non disponibile");
 }catch(e){return fail(e)}
}
export async function PATCH(request:Request,{params}:Params){
 try{
  const p=(await params).parts,ctx=await auth();
  if(p[0]!=="clients")throw new ApiFailure(404,"Risorsa non trovata");
  const id=validId(p[1]);await requireClient(ctx,id);
  if(p.length===2){
   const input=await read(request,clientSchema.partial().refine(x=>Object.keys(x).length>0));
   const {data,error}=await ctx.db.from("clients").update(input).eq("id",id).select().single();
   dbError(error,"Cliente non aggiornato");await audit(ctx,id,"client_updated",id);
   return json({client:data});
  }
  if(p.length===4 && p[2]==="offers"){
   const offerId=validId(p[3]);
   const input=await read(request,offerSchema.partial().refine(x=>Object.keys(x).length>0));
   const {data,error}=await ctx.db.from("offers").update(input).eq("id",offerId).eq("client_id",id).select().maybeSingle();
   dbError(error,"Offerta non aggiornata");if(!data)throw new ApiFailure(404,"Offerta non trovata");
   await audit(ctx,id,"offer_updated",offerId);return json({offer:data});
  }
  if(p.length===4 && p[2]==="contents"){
   const contentId=validId(p[3]);
   const input=await read(request,updateContentSchema.refine(x=>Object.keys(x).length>0));
   const {data:current}=await ctx.db.from("contents").select("revision,offer_id,offer_version,parent_id,source_revision,status,format,slides").eq("id",contentId).eq("client_id",id).maybeSingle();
   if(!current)throw new ApiFailure(404,"Contenuto non trovato");
   if(input.status==="approved" && current.status==="stale")throw new ApiFailure(409,"La bozza è obsoleta: verificane le dipendenze prima di approvarla");
   if(input.status==="approved"){
     const finalSlides=Array.isArray(input.slides)?input.slides:
       Array.isArray(current.slides)?current.slides as Array<{headline:string;body:string;layout?:"cover"|"content"|"quote"|"closing"}>:[];
     if((current.format==="carousel"||current.format==="document")&&
        (finalSlides.length<3||finalSlides.length>8))
       throw new ApiFailure(422,"Caroselli e documenti richiedono fra 3 e 8 slide");
     const problems=finalSlides.flatMap(slidePreflight).filter(x=>x.severity==="blocking");
     if(problems.length)throw new ApiFailure(422,"Controllo grafico: "+problems[0].message);
   }
   if(input.editorial_brief?.community_signal_ids?.length){
     const ids=input.editorial_brief.community_signal_ids;
     const {data:linked,error:linkedError}=await ctx.db.from("community_signals").select("id").eq("client_id",id).in("id",ids);
     dbError(linkedError);
     if((linked||[]).length!==new Set(ids).size)throw new ApiFailure(400,"Un segnale della community non appartiene a questo cliente");
   }
   if(input.slides?.some(slide=>slide.image_path && (!slide.image_path.startsWith(id+"/")||slide.image_path.includes(".."))))throw new ApiFailure(403,"Immagine fuori dal profilo cliente");
   if(input.status==="approved" && current.offer_id){
     const {data:offer}=await ctx.db.from("offers").select("version,status").eq("id",current.offer_id).eq("client_id",id).maybeSingle();
     if(!offer||offer.status!=="verified"||offer.version!==current.offer_version)throw new ApiFailure(409,"Offerta cambiata: aggiorna il contenuto");
   }
   if(input.status==="approved" && current.parent_id){
     const {data:parent}=await ctx.db.from("contents").select("revision").eq("id",current.parent_id).eq("client_id",id).maybeSingle();
     if(!parent||parent.revision!==current.source_revision)throw new ApiFailure(409,"Originale Instagram cambiato: riadatta LinkedIn");
   }
   const {data,error}=await ctx.db.from("contents").update(input).eq("id",contentId).eq("client_id",id).eq("revision",current.revision).select().maybeSingle();
   dbError(error,"Modifica non salvata");if(!data)throw new ApiFailure(409,"Il contenuto è cambiato: aggiorna la pagina");
   await audit(ctx,id,"content_updated",contentId);return json({content:data});
  }
  throw new ApiFailure(404,"Aggiornamento non disponibile");
 }catch(e){return fail(e)}
}

export async function DELETE(_request:Request,{params}:Params){
 try{
  const p=(await params).parts,ctx=await auth();
  if(p[0]!=="clients")throw new ApiFailure(404,"Risorsa non trovata");
  const id=validId(p[1]);await requireClient(ctx,id);
  if(p.length===4&&p[2]==="signals"){
   const signalId=validId(p[3]);
   const {data,error}=await ctx.db.from("community_signals").delete().eq("id",signalId).eq("client_id",id).select("id").maybeSingle();
   dbError(error,"Impossibile eliminare l'osservazione");
   if(!data)throw new ApiFailure(404,"Osservazione non trovata");
   await audit(ctx,id,"community_signal_deleted",signalId);
   return json({deleted:true});
  }
  throw new ApiFailure(404,"Eliminazione non disponibile");
 }catch(e){return fail(e)}
}
