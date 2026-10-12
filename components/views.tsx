"use client";
import { useEffect,useReducer,useState } from "react";
import { ArrowRight,Archive,BookOpen,CalendarDays,Check,ChevronLeft,ChevronRight,Clock,FileText,Globe,Instagram,Layers3,Package,Plus,RefreshCw,Sparkles,Target,UploadCloud,AlertTriangle,Image as ImageIcon,ExternalLink } from "lucide-react";
import type { Snapshot,View,Offer,Content,Slide,EditorialBrief } from "./types";
import { offerLabel,statusLabel,requestJson } from "./types";
import { audiencePatterns } from "@/lib/audience";
import { brandStyle } from "@/lib/brand";
import { summarizeInstagram } from "@/lib/social-analytics";
import EditorialCalendar from "./editorial-calendar";
import {resolvedLayout,layoutStyle,slidePreflight,slideHistoryReducer} from "@/lib/carousel-layout";

type Props={
 data:Snapshot;view:View;
 onView:(v:View)=>void;
 onModal:(name:string,item?:unknown)=>void;
 onAction:(name:string,body?:Record<string,unknown>)=>Promise<unknown>;
 onChat:()=>void;
 busy:string|null;
};

function Badge({value}:{value:string}){return <span className={"pill "+(["stale","draft","proposed","running"].includes(value)?"warn":value==="failed"?"danger":value==="archived"?"muted":"")}>{statusLabel(value)}</span>}
function Header({k,title,sub,actions}:{k:string;title:string;sub:string;actions?:React.ReactNode}){
 return <header className="page-head"><div><div className="eyebrow">{k}</div><h1>{title}</h1><p>{sub}</p></div><div className="page-actions">{actions}</div></header>;
}
function Empty({title,text,children}:{title:string;text:string;children?:React.ReactNode}){
 return <div className="empty"><strong style={{display:"block",color:"var(--ink)",fontSize:15,marginBottom:5}}>{title}</strong>{text}<div style={{marginTop:14}}>{children}</div></div>;
}
export default function Views(props:Props){
 const {data,view}=props;
 if(view==="today")return <Today {...props}/>;
 if(view==="knowledge")return <Knowledge key={data.client.id} {...props}/>;
 if(view==="offers")return <Offers {...props}/>;
 if(view==="projects")return <Projects key={data.client.id} {...props}/>;
 return <Results {...props}/>;
}
function Today({data,onView,onChat,onModal,onAction}:{data:Snapshot;onView:(v:View)=>void;onChat:()=>void;onModal:(name:string)=>void;onAction:Props["onAction"]}){
 const dossier=data.dossiers[0],strategy=data.strategies?.[0],verified=data.offers.filter(o=>o.status==="verified").length;
 const pending=data.missions.filter(x=>x.status==="proposed").length;
 const step=!data.sources.length&&!data.offers.length?{title:"Costruiamo la conoscenza del cliente",detail:"Aggiungi sito, documenti e informazioni fondamentali per permettere agli agenti di lavorare con dati reali.",action:"Aggiungi informazioni",view:"knowledge" as View}:
   !dossier||dossier.status!=="approved"?{title:"Completa e approva il dossier",detail:"Controlla la fotografia attuale dell'azienda. La strategia sarà costruita solo su informazioni verificate.",action:"Apri il dossier",view:"knowledge" as View}:
   !strategy||strategy.status!=="approved"?{title:"Completa e approva il piano strategico",detail:"La strategia centrale definisce posizionamento, target, KPI e roadmap. Le campagne future dovranno rispettarla.",action:"Apri la strategia",view:"knowledge" as View}:
   !verified?{title:"Verifica prodotti e servizi",detail:"Registra le offerte da promuovere per collegarle alle campagne senza inventare prezzi o benefici.",action:"Apri il catalogo",view:"offers" as View}:
   {title:"Qual è il prossimo obiettivo?",detail:"Il Leader può coordinare una campagna usando il dossier, le offerte e i risultati disponibili.",action:"Parla con il Leader",view:"projects" as View};
 return <>
  <Header k="WORKSPACE / CLIENTE ATTIVO" title={"Buongiorno, lavoriamo su "+data.client.name+". "}
   sub="Tutto ciò che serve per capire il brand, creare e migliorare i contenuti." actions={<button className="button primary" onClick={onChat}><Sparkles size={16}/> Chiedi al Leader</button>}/>
  <div className="grid3">
   <div className="card metric-card"><span className="muted">Stato conoscenza</span><div><strong style={{fontSize:19}}>{dossier?.status==="approved"?"Approvata":dossier?"Da rivedere":"Da creare"}</strong><div className="stat-line"><span>{data.sources.length} fonti nel profilo</span></div></div></div>
   <div className="card metric-card"><span className="muted">Prodotti e servizi verificati</span><div><strong>{verified}</strong><div className="stat-line"><span>su {data.offers.length} offerte registrate</span></div></div></div>
   <div className="card metric-card"><span className="muted">Progetti e approvazioni</span><div><strong>{data.campaigns.length}</strong><div className="stat-line"><span>{pending} proposte AI in attesa</span></div></div></div>
  </div>
  {data.ai_jobs?.length>0&&<div className="card" style={{marginTop:18}}><div className="section-title"><h2>Attività del team AI</h2><span className="caption">I lavori continuano senza tenere aperta la chat</span></div>{data.ai_jobs.slice(0,5).map(job=><div className="list-row" key={job.id}><div><strong>{job.kind==="dossier"?"Analisi aziendale":job.kind==="strategy"?"Piano strategico":"Missione multi-agente"}</strong><div className="caption">Tentativo {job.attempts}/{job.max_attempts} · {new Date(job.created_at).toLocaleString("it-IT")}</div>{job.error&&<div className="caption" style={{color:"var(--danger)"}}>{job.error}</div>}</div><div className="flex center gap8"><span className={"pill "+(["failed","queued"].includes(job.status)?"warn":"")}>{job.status==="queued"?"In coda":job.status==="running"?"In esecuzione":job.status==="succeeded"?"Completato":job.status==="cancelled"?"Annullato":"Errore"}</span>{job.status==="queued"&&<button className="button small ghost" onClick={()=>onAction("cancelJob",{id:job.id})}>Annulla</button>}</div></div>)}</div>}
  <div className="next-step" style={{marginTop:18}}>
   <div><span className="eyebrow">IL PROSSIMO PASSO</span><h2>{step.title}</h2><p>{step.detail}</p></div>
   <button className="button primary" onClick={()=>step.action==="Parla con il Leader"?onChat():onView(step.view)}>{step.action}<ArrowRight size={16}/></button>
  </div>
  <div className="grid2" style={{marginTop:19}}>
   <div className="card"><div className="section-title"><h2>Progetti recenti</h2><button className="button small ghost" onClick={()=>onView("projects")}>Vedi tutti <ArrowRight size={13}/></button></div>
    {data.campaigns.length?data.campaigns.slice(0,5).map(c=><div className="list-row" key={c.id}><div><strong>{c.title}</strong><div className="caption">{c.period} · {c.objective.slice(0,80)}</div></div><Badge value={c.status}/></div>):
     <Empty title="Nessun progetto" text="Quando approverai una proposta AI, la campagna comparirà qui."><button className="button small" onClick={onChat}>Inizia una campagna</button></Empty>}
   </div>
   <div className="card"><div className="section-title"><h2>La memoria del cliente</h2><button className="button small ghost" onClick={()=>onView("results")}>Risultati <ArrowRight size={13}/></button></div>
    <p className="tagline">Ogni nuova strategia può utilizzare le campagne precedenti e i dati importati dai social. Non vengono mostrati numeri inventati.</p>
    <div className="separator"/>
    <div className="info-pair"><span>Campagne nello storico</span><strong>{data.campaigns.length}</strong></div>
    <div className="info-pair"><span>Rilevazioni Instagram reali</span><strong>{data.social_snapshots.length}</strong></div>
    <div className="info-pair"><span>Account Instagram collegati</span><strong>{data.social_accounts.length}</strong></div>
   </div>
  </div>
  <div className="card" style={{marginTop:18}}><div className="section-title"><h2>Come lavora Forgecy</h2></div>
    <div className="steps">{[["01","Conosce il cliente","Fonti e offerte verificate"],["02","Propone","Leader e agenti collaborano"],["03","Produce","Post, caroselli e LinkedIn"],["04","Migliora","Risultati e apprendimenti"]].map(s=><div className="step" key={s[0]}><span className="eyebrow">{s[0]}</span><b>{s[1]}</b><small>{s[2]}</small></div>)}</div>
  </div>
 </>;
}
function Knowledge({data,onModal,onAction,busy}:{data:Snapshot;onModal:Props["onModal"];onAction:Props["onAction"];busy:string|null}){
 const [tab,setTab]=useState<"dossier"|"strategy"|"sources"|"community"|"profile">("dossier");
 const [sourceQuery,setSourceQuery]=useState("");
 const [foundSources,setFoundSources]=useState<Array<{
  id:string;title:string;kind:string;url:string|null;excerpt:string;relevance:number
 }>>([]);
 const [searchStatus,setSearchStatus]=useState<"idle"|"loading"|"ready"|"error">("idle");
 useEffect(()=>{
  if(sourceQuery.trim().length<2)return;
  let stale=false;
  const timer=window.setTimeout(()=>{
   setSearchStatus("loading");
   requestJson<{results:typeof foundSources}>(
    "/api/workspace/clients/"+data.client.id+"/sources/search?q="+encodeURIComponent(sourceQuery.trim())
   ).then(answer=>{if(!stale){setFoundSources(answer.results);setSearchStatus("ready");}})
    .catch(()=>{if(!stale){setFoundSources([]);setSearchStatus("error");}});
  },260);
  return()=>{stale=true;window.clearTimeout(timer);};
 },[sourceQuery,data.client.id]);
 const signals=data.community_signals||[];
 const patterns=audiencePatterns(signals);
 const dossier=data.dossiers[0],approval=dossier?.status==="draft" && dossier.knowledge_revision===data.client.knowledge_revision;
 const dossierJob=data.ai_jobs?.find(j=>j.kind==="dossier"&&(j.status==="queued"||j.status==="running"));
 const strategy=data.strategies?.[0],strategyJob=data.ai_jobs?.find(j=>j.kind==="strategy"&&(j.status==="queued"||j.status==="running"));
 return <>
  <Header k="BIBLIOTECA / CONOSCENZA" title="Conoscere prima di creare." sub={"Le informazioni di "+data.client.name+" alimentano tutto il lavoro del team AI."}
   actions={<button className="button" onClick={()=>onModal("source")}><Plus size={16}/> Aggiungi fonte</button>}/>
  <div className="tabs">{[["dossier","Analisi aziendale"],["strategy","Strategia"],["sources","Fonti e documenti"],["community","Voce della community"],["profile","Profilo brand"]].map(([k,t])=><button key={k} onClick={()=>setTab(k as typeof tab)} className={"tab "+(tab===k?"active":"")}>{t}</button>)}</div>
  {tab==="dossier"&&<div className="stack-lg">
   <div className="card">
    <div className="flex between center gap12 wrap"><div><h2>Dossier aziendale</h2><p className="caption" style={{marginTop:6}}>Fotografia documentata della situazione attuale, non un piano strategico.</p></div>{dossier?<Badge value={dossier.status}/>:<span className="pill muted">Non presente</span>}</div>
    <div className="separator"/>
    {!dossier?<Empty title="Il dossier non esiste ancora" text="Aggiungi sito, note oppure offerte commerciali e fai analizzare le fonti dagli agenti."/>:
     <><p className="prose">{dossier.summary}</p><div className="caption" style={{marginTop:14}}>Versione {dossier.version} · Revisione della conoscenza {dossier.knowledge_revision}</div>{dossier.evidence_report&&<div className="caption" style={{marginTop:7}}>Verifica citazioni: {dossier.evidence_report.verified} affermazioni con estratto testuale · {dossier.evidence_report.inferred} ipotesi · {dossier.evidence_report.unknown} dati mancanti{dossier.evidence_report.downgraded>0?" · "+dossier.evidence_report.downgraded+" riclassificate dopo il controllo":""}. La corrispondenza con una fonte non è un fact-check indipendente.</div>}</>}
    <div className="flex gap8 wrap" style={{marginTop:20}}>
     <button disabled={Boolean(busy)||Boolean(dossierJob)||(!data.sources.length&&!data.offers.length)} className="button primary" onClick={()=>onAction("dossierDraft")}><Sparkles size={15}/>{dossierJob?"Analisi "+(dossierJob.status==="queued"?"in coda":"in corso")+"…":busy==="dossierDraft"?"Accodamento…":"Analizza e crea nuova versione"}</button>
     {approval&&<button className="button" onClick={()=>onAction("dossierApprove",{dossier_id:dossier.id})}><Check size={15}/> Approva dossier</button>}
     {dossier&&<a className="button" href={"/api/workspace/clients/"+data.client.id+"/reports/dossier"} target="_blank" rel="noopener noreferrer"><FileText size={14}/> Esporta dossier MD</a>}
    </div>
    {dossier?.status==="stale"&&<div className="notice warn" style={{marginTop:13}}>Hai modificato fonti, brand o offerte: questa analisi non è più aggiornata. Genera e approva una nuova versione.</div>}
   </div>
   {dossier?.findings?.length>0&&<div className="card"><div className="section-title"><h2>Evidenze e ipotesi</h2></div>
    <div className="grid2">{dossier.findings.map((f,i)=><div className="finding" key={i}><div className="flex center between gap8"><strong>{f.topic}</strong><span className={"pill "+(f.certainty==="verified"?"":"warn")}>{f.certainty==="verified"?"Citazione presente":f.certainty==="inferred"?"Ipotesi":"Da verificare"}</span></div><p>{f.claim}</p>{f.evidence_quote&&<blockquote className="caption" style={{margin:"10px 0 0",paddingLeft:10,borderLeft:"2px solid var(--line)"}}>“{f.evidence_quote}”</blockquote>}<div className="caption" style={{marginTop:7}}>Fonti: {f.source_ids.length?f.source_ids.map(sourceId=>data.sources.find(s=>s.id===sourceId)?.title||data.offers.find(o=>o.id===sourceId)?.name||data.community_signals.find(s=>s.id===sourceId)?.topic||data.social_snapshots.find(s=>s.id===sourceId)?.period||"Fonte "+sourceId.slice(0,8)).join(" · "):"Non indicate"}</div></div>)}</div>
   </div>}
  </div>}
  {tab==="strategy"&&<div className="stack-lg">
   <div className="card">
    <div className="flex between center wrap gap12"><div><h2>Piano strategico</h2><p className="caption">La direzione approvata per tutte le campagne del cliente.</p></div>{strategy?<Badge value={strategy.status}/>:<span className="pill muted">Non presente</span>}</div>
    {strategy?<><div className="separator"/><h2>{strategy.blueprint.title}</h2><p className="prose">{strategy.blueprint.diagnosis}</p><div className="caption">Versione {strategy.version}</div></>:<Empty title="Manca il piano strategico" text="Approva il dossier per elaborare obiettivi, KPI, pubblico e roadmap."/>}
    <div className="flex gap8 wrap" style={{marginTop:18}}>
     <button className="button primary" disabled={Boolean(busy)||Boolean(strategyJob)||dossier?.status!=="approved"} onClick={()=>onAction("strategyDraft")}><Sparkles size={15}/>{strategyJob?"Elaborazione in corso…":"Genera piano strategico"}</button>
     {strategy?.status==="draft"&&strategy.knowledge_revision===data.client.knowledge_revision&&<button className="button" onClick={()=>onAction("strategyApprove",{id:strategy.id})}><Check size={15}/> Approva strategia</button>}
     {strategy&&<a className="button" href={"/api/workspace/clients/"+data.client.id+"/reports/strategy"} target="_blank" rel="noopener noreferrer"><FileText size={14}/> Esporta strategia MD</a>}
    </div>
    {strategy?.status==="stale"&&<div className="notice warn" style={{marginTop:14}}>Le fonti sono cambiate: genera una nuova versione del piano.</div>}
   </div>
   {strategy&&<div className="stack-lg">
    <div className="card"><h2>Posizionamento</h2><p className="prose">{strategy.blueprint.positioning}</p><div className="separator"/>{strategy.blueprint.audiences.map((a,i)=><div className="list-row" key={i}>{a}</div>)}</div>
    <div className="card"><h2>Obiettivi e KPI</h2>{strategy.blueprint.objectives.map((o,i)=><div className="finding" key={i} style={{marginTop:12}}><strong>{o.goal}</strong><p>{o.rationale}</p><div className="caption">KPI: {o.kpi} · Baseline: {o.baseline||"Da misurare"} · Target: {o.target}</div></div>)}</div>
    <div className="grid2">{strategy.blueprint.content_pillars.map((p,i)=><div className="card" key={i}><h2>{p.name}</h2><p className="tagline">{p.purpose}</p>{p.examples.map((e,j)=><p key={j} className="caption">• {e}</p>)}</div>)}</div>
    <div className="card"><h2>Roadmap 30 / 60 / 90 giorni</h2><div className="grid3">{[["30",strategy.blueprint.roadmap.days_30],["60",strategy.blueprint.roadmap.days_60],["90",strategy.blueprint.roadmap.days_90]].map(([days,items])=><div key={days as string}><strong>{days as string} giorni</strong>{(items as string[]).map((a,i)=><p className="caption" key={i}>• {a}</p>)}</div>)}</div></div>
    <div className="card"><h2>Rischi e lacune</h2>{[...strategy.blueprint.risks,...strategy.blueprint.unknowns].map((a,i)=><div className="list-row" key={i}>{a}</div>)}</div>
   </div>}
  </div>}
  {tab==="sources"&&<div className="stack-lg">
   <div className="flex between center wrap gap12"><p className="tagline">Siti web, note, file e profili social del cliente.</p><div className="flex gap8 wrap"><button className="button small" onClick={()=>onModal("source")}><Globe size={15}/> Aggiungi fonte</button><button className="button small" onClick={()=>onModal("upload")}><UploadCloud size={15}/> Carica documento</button></div></div>
   <div className="card">
     <label htmlFor="forgecy-source-search">Cerca in documenti, note e pagine del sito</label>
     <input id="forgecy-source-search" value={sourceQuery} maxLength={160}
      placeholder="Es. servizi, posizionamento, sostenibilità…"
      onChange={e=>{const value=e.target.value;setSourceQuery(value);if(value.trim().length<2){setFoundSources([]);setSearchStatus("idle");}}} style={{marginTop:8}}/>
     <p className="caption" style={{marginTop:7}}>Ricerca nei contenuti indicizzati del cliente attivo. Nessun dato di altri clienti è accessibile.</p>
     {sourceQuery.trim().length>=2&&<div style={{marginTop:14}}>
       {searchStatus==="loading"&&<p className="caption">Ricerca delle fonti in corso…</p>}
       {searchStatus==="error"&&<p className="caption">Ricerca temporaneamente non disponibile. Controlla che la migrazione 0011 sia stata eseguita.</p>}
       {searchStatus==="ready"&&(foundSources.length?foundSources.map(s=><div className="list-row" key={s.id}>
        <div style={{minWidth:0}}><strong>{s.title}</strong><p className="caption" style={{marginTop:6,whiteSpace:"pre-wrap"}}>{s.excerpt}</p>
         <p className="caption" style={{marginTop:5}}>Fonte: {s.kind}</p></div>
        {s.url&&/^https?:\/\//i.test(s.url)&&<a href={s.url} target="_blank" rel="noopener noreferrer" className="button small">Apri fonte <ExternalLink size={12}/></a>}
       </div>):<p className="caption">Nessuna corrispondenza nelle fonti disponibili.</p>)}
     </div>}
   </div>
   <div className="card">{data.sources.length?data.sources.map(s=><div className="list-row" key={s.id}><div className="flex center gap12"><div className="client-avatar">{s.kind==="website"?<Globe size={17}/>:<FileText size={17}/>}</div><div><strong>{s.title}</strong><div className="caption">{s.kind} · {s.body?.length||0} caratteri · {s.url||"Nessun URL"}</div>{s.error&&<div className="caption" style={{color:"var(--danger)"}}>{s.error}</div>}</div></div><div className="flex center gap8 wrap"><Badge value={s.status}/>{s.kind==="document"&&s.file_path&&s.status!=="ready"&&<button className="button small" onClick={()=>onAction("reprocessDocument",{id:s.id})}>Riprova</button>}</div></div>):
    <Empty title="Nessuna fonte" text="Inizia aggiungendo il sito del cliente, un brief o una nota."/>}
   </div>
   {data.sources.some(s=>s.status==="pending")&&<div className="notice warn">Alcune fonti non sono ancora leggibili. I PDF con testo e i DOCX sono supportati; per scansioni e immagini serve ancora OCR oppure una trascrizione testuale.</div>}
  </div>}
  {tab==="community"&&<div className="stack-lg">
   <div className="flex between center gap12 wrap">
    <div><h2>Ascolta, poi crea.</h2><p className="tagline" style={{marginTop:5}}>Domande, commenti, recensioni e obiezioni diventano spunti editoriali collegati al cliente.</p></div>
    <button className="button primary" onClick={()=>onModal("signal")}><Plus size={15}/> Registra un feedback</button>
   </div>
   <div className="notice">Inserisci solo osservazioni anonimizzate: niente nomi, email o dati privati dei clienti finali. Un commento isolato non rappresenta l&apos;intera community.</div>
   <div className="grid3">
    <div className="card metric-card"><span className="muted">Osservazioni raccolte</span><strong>{signals.length}</strong><small>Registrate manualmente</small></div>
    <div className="card metric-card"><span className="muted">Temi emersi</span><strong>{patterns.length}</strong><small>Argomenti raggruppati</small></div>
    <div className="card metric-card"><span className="muted">Pattern con fonti distinte</span><strong>{patterns.filter(p=>p.kind==="corroborated").length}</strong><small>Candidati da valutare, non trend certi</small></div>
   </div>
   {patterns.length>0&&<div className="card">
     <div className="section-title"><h2>Bisogni e temi ricorrenti</h2></div>
     <div className="grid2">{patterns.slice(0,12).map(p=><div className="finding" key={p.topic}>
       <div className="flex between center gap8"><strong>{p.topic}</strong><span className={"pill "+(p.kind==="isolated"?"warn":"")}>{p.kind==="corroborated"?"Fonti distinte":p.kind==="candidate"?"Da corroborare":"Ipotesi"}</span></div>
       <p>{p.observations} osservazioni · {p.distinct_references} riferimenti documentati</p>
       {p.needs.length>0&&<div className="caption" style={{marginTop:7}}>Bisogno: {p.needs.slice(0,2).join(" · ")}</div>}
     </div>)}</div>
   </div>}
   <div className="card"><div className="section-title"><h2>Archivio dei segnali</h2></div>
    {signals.length?signals.map(signal=><div className="list-row" key={signal.id}>
      <div className="stack" style={{gap:6}}>
       <div className="flex center gap8 wrap"><strong>{signal.topic}</strong><span className="pill muted">{signal.platform} / {signal.kind}</span><small>{signal.observed_at}</small></div>
       <p className="tagline">{signal.excerpt}</p>
       {signal.audience_need&&<p className="caption">Bisogno interpretato: {signal.audience_need}</p>}
       {signal.source_url&&<a className="caption" href={signal.source_url} target="_blank" rel="noopener noreferrer">Apri riferimento <ExternalLink size={12} style={{display:"inline"}}/></a>}
      </div>
      <button className="button small ghost" aria-label={"Elimina osservazione "+signal.topic} onClick={()=>{if(window.confirm("Eliminare questa osservazione?"))onAction("deleteSignal",{id:signal.id})}}>Elimina</button>
    </div>):<Empty title="Nessuna osservazione ancora" text="Registra una domanda ricorrente, un'obiezione o una recensione rilevante."><button className="button" onClick={()=>onModal("signal")}>Aggiungi il primo feedback</button></Empty>}
   </div>
  </div>}
  {tab==="profile"&&<div className="grid2">
   <div className="card"><div className="section-title"><h2>Identità cliente</h2><button className="button small" onClick={()=>onModal("profile")}>Modifica</button></div>
    <div className="info-pair"><span>Ragione sociale</span><strong>{data.client.name}</strong></div><div className="info-pair"><span>Settore</span><strong>{data.client.industry||"Da completare"}</strong></div><div className="info-pair"><span>Sito web</span><strong>{data.client.website||"Da completare"}</strong></div>
    <div className="separator"/><div className="flex center gap12 wrap">
     {[{label:"Primario",color:brandStyle(data.client.profile).primary},{label:"Sfondo",color:brandStyle(data.client.profile).background}].map(x=><div key={x.label} className="flex center gap8"><span style={{display:"inline-block",width:25,height:25,background:x.color,border:"1px solid #ddd",borderRadius:6}}/><small>{x.label}: {x.color}</small></div>)}
    </div><div className="caption" style={{marginTop:12}}>Font indicato: {brandStyle(data.client.profile).headingFont||"Non indicato"} (riferimento, non installato)</div>
    <div className="separator"/><pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit",fontSize:13,color:"var(--muted)"}}>{JSON.stringify(data.client.profile,null,2)}</pre>
   </div>
   <div className="card"><BookOpen size={20}/><h2 style={{marginTop:14}}>Una sola fonte di verità</h2><p className="tagline" style={{marginTop:10}}>Quando cambi identità, offerta o documenti, il dossier precedente viene invalidato. Nessuna strategia futura potrà riutilizzarlo senza revisione.</p></div>
  </div>}
 </>;
}
function Offers({data,onModal,onAction}:{data:Snapshot;onModal:Props["onModal"];onAction:Props["onAction"]}){
 const [filter,setFilter]=useState<"all"|"product"|"service">("all");
 const items=data.offers.filter(o=>filter==="all"||o.kind===filter);
 return <>
  <Header k="BIBLIOTECA / OFFERTA" title="Prodotti e servizi." sub="Una scheda affidabile per tutto ciò che il cliente vuole vendere e promuovere."
   actions={<button className="button primary" onClick={()=>onModal("offer")}><Plus size={16}/> Nuova offerta</button>}/>
  <div className="tabs">{[["all","Tutte"],["product","Prodotti"],["service","Servizi"]].map(([k,t])=><button key={k} className={"tab "+(filter===k?"active":"")} onClick={()=>setFilter(k as typeof filter)}>{t} {k==="all"?"("+data.offers.length+")":""}</button>)}</div>
  {items.length?<div className="grid2">{items.map(o=><div className="card stack" key={o.id}>
   <div className="flex between center"><span className="offer-type">{o.kind==="product"?"Prodotto fisico":"Servizio"}</span><Badge value={o.status}/></div>
   <h2>{o.name}</h2><p className="tagline">{o.description||"Descrizione da completare."}</p>
   <div className="info-pair"><span>Prezzo</span><strong>{offerLabel(o)}</strong></div>
   <div className="info-pair"><span>Destinatari</span><strong>{o.audience||"Non indicati"}</strong></div>
   <div className="caption">Versione {o.version} · {o.benefits.length} benefici registrati</div>
   <div className="flex gap8 wrap" style={{marginTop:5}}>
    <button className="button small" onClick={()=>onModal("offer",o)}>Modifica</button>
    {o.status==="draft"&&<button className="button small primary" onClick={()=>onAction("verifyOffer",{id:o.id})}><Check size={13}/> Conferma dati</button>}
    {o.status==="verified"&&<button className="button small" onClick={()=>onModal("campaign",{offer_id:o.id})}>Promuovi <ArrowRight size={13}/></button>}
   </div>
  </div>)}</div>:
  <Empty title="Nessuna offerta in questa categoria" text="Registra prodotti e servizi, quindi verifica i dati commerciali per utilizzarli nelle campagne."><button className="button primary" onClick={()=>onModal("offer")}><Plus size={15}/> Aggiungi la prima offerta</button></Empty>}
  <div className="notice" style={{marginTop:20}}>I prodotti verificati alimentano il dossier e le campagne. Una modifica al prezzo o ai benefici segnala automaticamente le bozze collegate come da aggiornare.</div>
 </>;
}
function Projects({data,onModal,onAction,onChat,busy}:{data:Snapshot;onModal:Props["onModal"];onAction:Props["onAction"];onChat:()=>void;busy:string|null}){
 const [campaignId,setCampaignId]=useState<string|null>(null);
 const [calendarOpen,setCalendarOpen]=useState(false);
 const [contentId,setContentId]=useState<string|null>(null);
 const [tab,setTab]=useState<"brief"|"production">("production");
 const campaign=data.campaigns.find(c=>c.id===campaignId);
 const contents=campaign?data.contents.filter(c=>c.campaign_id===campaign.id):[];
 const chosen=contents.find(c=>c.id===contentId);
 return <>
  <Header k="PROGETTI / OBIETTIVI" title="Dall'obiettivo alla pubblicazione." sub="Ogni campagna tiene insieme strategia, calendario, post e adattamenti LinkedIn."
   actions={<div className="flex gap8 wrap"><button className={"button "+(calendarOpen?"primary":"")} onClick={()=>setCalendarOpen(v=>!v)}><CalendarDays size={16}/>{calendarOpen?"Torna ai progetti":"Calendario editoriale"}</button><button className="button primary" onClick={onChat}><Sparkles size={16}/> Affida un obiettivo al Leader</button></div>}/>
  {calendarOpen&&<EditorialCalendar data={data} onAction={onAction} busy={busy}/>}
  {!calendarOpen&&chosen&&<ContentEditor key={chosen.id+":"+chosen.revision} content={chosen} clientName={data.client.name} profile={data.client.profile} onBack={()=>setContentId(null)} onAction={onAction} busy={busy}/>}
  {!calendarOpen&&!chosen&&campaign&&<div className="stack-lg">
   <div className="flex between center wrap gap12"><button className="button small ghost" onClick={()=>setCampaignId(null)}><ChevronLeft size={16}/> Tutti i progetti</button><Badge value={campaign.status}/></div>
   <div><div className="eyebrow">{campaign.period}</div><h2 style={{fontSize:25,marginTop:5}}>{campaign.title}</h2><p className="tagline" style={{marginTop:6}}>{campaign.objective}</p></div>
   <div className="tabs"><button className={"tab "+(tab==="brief"?"active":"")} onClick={()=>setTab("brief")}>Strategia e brief</button><button className={"tab "+(tab==="production"?"active":"")} onClick={()=>setTab("production")}>Produzione ({contents.length})</button></div>
   {tab==="brief"?<div className="card"><h2 style={{marginBottom:14}}>Piano strategico</h2><div className="prose">{JSON.stringify(campaign.strategy,null,2)}</div></div>:
    <div className="stack-lg">
     <div className="flex between center wrap gap12"><h2>Contenuti della campagna</h2><button className="button" onClick={()=>onModal("content",{campaign_id:campaign.id})}><Plus size={15}/> Nuovo post</button></div>
     {contents.length?<div className="grid2">{contents.map(c=><button className="click-card stack" onClick={()=>setContentId(c.id)} key={c.id}>
      <div className="flex between center gap8"><span className="offer-type">{c.channel==="instagram"?"Instagram":"LinkedIn"} · {c.format}</span><Badge value={c.status}/></div>
      <h3 style={{fontSize:17}}>{c.title}</h3><p className="caption">{c.caption.slice(0,135)||"Apri per scrivere la didascalia."}</p>
      <div className="flex between center"><span className="caption">{c.slides.length} pagine · Rev. {c.revision}</span><ArrowRight size={16}/></div>
     </button>)}</div>:
     <Empty title="Nessun contenuto" text="Puoi aggiungere un post o chiedere al Leader una proposta di campagna completa."><button className="button" onClick={()=>onModal("content",{campaign_id:campaign.id})}>Crea post</button></Empty>}
    </div>}
  </div>}
  {!calendarOpen&&!chosen&&!campaign&&(data.campaigns.length?<div className="grid2">{data.campaigns.map(c=><button key={c.id} className="click-card stack" onClick={()=>{setCampaignId(c.id);setTab("production")}}>
   <div className="flex between center"><span className="eyebrow">{c.period}</span><Badge value={c.status}/></div>
   <h2>{c.title}</h2><p className="tagline">{c.objective}</p>
   <div className="flex between center"><span className="caption">{data.contents.filter(x=>x.campaign_id===c.id).length} contenuti</span><ArrowRight size={16}/></div>
  </button>)}</div>:
  <Empty title="Nessun progetto ancora" text="Parti da un obiettivo commerciale: il Leader creerà una proposta completa da approvare."><button className="button primary" onClick={onChat}>✧ Avvia una campagna</button></Empty>)}
 </>;
}
function ContentEditor({content,clientName,profile,onBack,onAction,busy}:{content:Content;clientName:string;profile:Record<string,unknown>;onBack:()=>void;onAction:Props["onAction"];busy:string|null}){
 const palette=brandStyle(profile);
 const [title,setTitle]=useState(content.title),[caption,setCaption]=useState(content.caption);
 const [history,dispatchHistory]=useReducer(slideHistoryReducer,{
   past:[],present:content.slides||[],future:[]
 });
 const slides=history.present;
 const setSlides=(update:Slide[]|((current:Slide[])=>Slide[]))=>{
   const next=typeof update==="function"?update(slides):update;
   dispatchHistory({type:"edit",slides:next});
 };
 const [brief,setBrief]=useState<Partial<EditorialBrief>>(content.editorial_brief||{});
 const [idx,setIdx]=useState(0);
 const current=slides[idx];
 const slidePreset=layoutStyle(resolvedLayout(current?.layout));
 const slideIssues=current?slidePreflight(current):[];
 const [resolvedImage,setResolvedImage]=useState<{path:string;url:string}|null>(null);
 // A new slide must never temporarily show the previous slide's image.
 const imageSrc=resolvedImage && resolvedImage.path===current?.image_path?resolvedImage.url:"";
 useEffect(()=>{
  let cancelled=false;
  const path=current?.image_path;
  if(!path)return;
  import("./types").then(m=>m.requestJson<{url:string}>(
    "/api/workspace/clients/"+content.client_id+"/assets?path="+encodeURIComponent(path)
  )).then(v=>{if(!cancelled)setResolvedImage({path,url:v.url});})
    .catch(()=>{if(!cancelled)setResolvedImage({path,url:""});});
  return()=>{cancelled=true};
 },[content.client_id,current?.image_path]);
 const save=async(status?:"draft"|"review"|"approved")=>{
  const change:Record<string,unknown>={id:content.id,title,caption,slides,editorial_brief:{audience_need:brief.audience_need||"",hook:brief.hook||"",promise:brief.promise||"",value_delivered:brief.value_delivered||"",emotional_angle:brief.emotional_angle||"",rational_proof:brief.rational_proof||"",single_cta:brief.single_cta||"",community_signal_ids:brief.community_signal_ids||[]}};
  if(status)change.status=status;
  return await onAction("updateContent",change);
 };
 const exportRoot="/api/workspace/clients/"+content.client_id+"/contents/"+content.id+"/export";
 return <div className="stack-lg">
  <div className="flex between center gap12 wrap"><button className="button small ghost" onClick={onBack}><ChevronLeft size={16}/> Torna ai contenuti</button><Badge value={content.status}/></div>
  <div><div className="eyebrow">{content.channel==="instagram"?"INSTAGRAM":"LINKEDIN"} · {content.format}</div><h2 style={{fontSize:22,marginTop:5}}>Modifica il contenuto</h2><p className="caption">Revisioni separate per canale, con collegamento all&apos;originale quando presente.</p></div>
  {content.status==="stale"&&<div className="notice warn">Questa bozza utilizza informazioni o una versione originale che sono cambiate. Rivedila prima dell&apos;approvazione.</div>}
  <div className="content-editor">
   <div className="card stack">
    <label>Titolo del contenuto</label><input value={title} onChange={e=>setTitle(e.target.value)} maxLength={240}/>
    <label>Didascalia</label><textarea value={caption} onChange={e=>setCaption(e.target.value)} rows={7} maxLength={12000}/>
    <details className="finding" style={{marginTop:8}}>
     <summary style={{cursor:"pointer",fontWeight:800,fontSize:13}}>Perché questo contenuto? · Rationale creativo</summary>
     <p className="caption" style={{margin:"10px 0"}}>Verifica che la promessa del gancio sia mantenuta, il beneficio sia concreto e la CTA abbia un solo obiettivo. Le note sono modificabili, non un punteggio automatico.</p>
     {([
       ["audience_need","Bisogno reale del pubblico"],
       ["hook","Gancio / prima promessa"],
       ["promise","Cosa promette il contenuto"],
       ["value_delivered","Come viene mantenuta la promessa"],
       ["emotional_angle","Beneficio emotivo (senza manipolazione)"],
       ["rational_proof","Prova concreta o limite dell'affermazione"],
       ["single_cta","Un'unica CTA o nessuna"]
      ] as Array<[keyof EditorialBrief,string]>).map(([key,label])=><div key={key} style={{marginTop:12}}>
       <label>{label}</label><textarea rows={2} value={String(brief[key]||"")} onChange={e=>setBrief(v=>({...v,[key]:e.target.value}))}/>
      </div>)}
     {!!brief.community_signal_ids?.length&&<p className="caption" style={{marginTop:12}}>Osservazioni collegate: {brief.community_signal_ids.length}. Controllale nella Biblioteca del cliente.</p>}
    </details>
    {slides.length===0 && (content.format==="carousel"||content.format==="document")&&<button className="button small" onClick={()=>{setSlides([{headline:"Prima pagina",body:"",visual_prompt:""}]);setIdx(0)}}><Plus size={14}/> Aggiungi la prima pagina</button>}
    {slides.length>0&&<><div className="separator"/><div className="flex between center wrap gap8">
      <label>Slide {idx+1} di {slides.length}</label>
      <div className="flex gap8">
       <button className="button small" disabled={!history.past.length} onClick={()=>dispatchHistory({type:"undo"})}>Annulla modifica</button>
       <button className="button small" disabled={!history.future.length} onClick={()=>dispatchHistory({type:"redo"})}>Ripeti</button>
      </div>
     </div>
     <label>Struttura grafica</label><select value={resolvedLayout(current?.layout)} onChange={e=>setSlides(v=>v.map((x,i)=>i===idx?{...x,layout:resolvedLayout(e.target.value)}:x))}><option value="cover">Copertina</option><option value="content">Contenuto</option><option value="quote">Citazione / evidenza</option><option value="closing">Conclusione / CTA</option></select>
     <label>Titolo slide</label><textarea rows={3} value={current?.headline||""} onChange={e=>setSlides(prev=>prev.map((x,i)=>i===idx?{...x,headline:e.target.value}:x))}/>
     <label>Testo slide</label><textarea rows={4} value={current?.body||""} onChange={e=>setSlides(prev=>prev.map((x,i)=>i===idx?{...x,body:e.target.value}:x))}/>
     <div className="caption">Titolo: {(current?.headline||"").length} caratteri · Testo: {(current?.body||"").length} caratteri</div>
     {slideIssues.length>0&&<div className="notice warn">{slideIssues.map((issue,i)=><p key={i}>{issue.severity==="blocking"?"Da correggere":"Da verificare"}: {issue.message}</p>)}</div>}
     <label>Prompt visivo</label><textarea rows={3} value={current?.visual_prompt||""} onChange={e=>setSlides(prev=>prev.map((x,i)=>i===idx?{...x,visual_prompt:e.target.value}:x))}/>
     <div className="flex gap8 wrap">
      <button className="button small" onClick={()=>{setSlides(s=>[...s.slice(0,idx+1),{headline:"Nuova pagina",body:"",layout:"content"},...s.slice(idx+1)]);setIdx(idx+1)}}><Plus size={14}/> Pagina</button>
      <button className="button small" onClick={()=>{setSlides(s=>[...s.slice(0,idx+1),{...s[idx]},...s.slice(idx+1)]);setIdx(idx+1)}}>Duplica</button>
      <button className="button small" disabled={idx===0} onClick={()=>{const next=[...slides];[next[idx-1],next[idx]]=[next[idx],next[idx-1]];setSlides(next);setIdx(idx-1)}}>Sposta ←</button>
      <button className="button small" disabled={idx>=slides.length-1} onClick={()=>{const next=[...slides];[next[idx+1],next[idx]]=[next[idx],next[idx+1]];setSlides(next);setIdx(idx+1)}}>Sposta →</button>
      <button className="button small" disabled={slides.length<=1} onClick={()=>{setSlides(s=>s.filter((_,i)=>i!==idx));setIdx(0)}}>Rimuovi</button>
     </div>
     <button className="button small" disabled={Boolean(busy)} onClick={async()=>{if(await save())await onAction("image",{id:content.id,slideIndex:idx,prompt:current?.visual_prompt||current?.headline||""})}}><ImageIcon size={14}/> Genera immagine con OpenAI</button>
    </>}
    <div className="separator"/><div className="flex gap8 wrap"><button className="button primary" disabled={Boolean(busy)} onClick={()=>save()}>Salva modifiche</button><button className="button" disabled={Boolean(busy)||content.status==="stale"} onClick={()=>save("approved")}><Check size={14}/> Approva</button></div>
    {content.channel==="instagram"&&<button className="button" disabled={Boolean(busy)||content.status==="stale"} onClick={()=>onAction("adapt",{id:content.id})}><Layers3 size={15}/> Riadatta per LinkedIn</button>}
   </div>
   <div className="card" style={{background:"#f5f8f4"}}>
    {slides.length?<><div className="eyebrow" style={{textAlign:"center",marginBottom:16}}>ANTEPRIMA · {content.channel==="instagram"?"4:5 · 1080×1350":"16:9 · 1920×1080"} · PAGINA {idx+1}/{slides.length}</div>
     <div className="slide" style={{backgroundColor:palette.background,color:palette.text,aspectRatio:content.channel==="linkedin"?"16 / 9":"4 / 5",maxWidth:content.channel==="linkedin"?"100%":"350px",...(imageSrc?{backgroundImage:"linear-gradient(#e1ead8b8,#e1ead8b8),url("+JSON.stringify(imageSrc)+")",backgroundSize:"cover",backgroundPosition:"center"}:{})}}>
      <div style={{fontSize:11,letterSpacing:".14em",fontWeight:800}}>{clientName.slice(0,32).toUpperCase()} · {content.channel.toUpperCase()}</div>
      <div style={{textAlign:slidePreset.textAlign}}><h3>{current?.headline}</h3><p style={{marginTop:14}}>{current?.body}</p></div>
      <div style={{fontSize:11,fontWeight:750}}>DESIGN CONTESTUALE · {idx+1}</div>
     </div>
     <div className="slide-nav"><button className="button small" disabled={idx===0} onClick={()=>setIdx(i=>i-1)}><ChevronLeft size={15}/></button><span className="caption">{idx+1} / {slides.length}</span><button className="button small" disabled={idx===slides.length-1} onClick={()=>setIdx(i=>i+1)}><ChevronRight size={15}/></button></div>
     <div className="flex center gap8 wrap" style={{justifyContent:"center",marginTop:14}}><a className="button small" href={exportRoot+"?format=png&slide="+idx} target="_blank" rel="noreferrer">Esporta PNG</a>{content.channel==="linkedin"&&<a className="button small" href={exportRoot+"?format=pdf"} target="_blank" rel="noreferrer">Esporta PDF</a>}</div>
     <p className="caption" style={{marginTop:8,textAlign:"center"}}>Esportazione basata sull’ultima versione salvata.</p>
    </>:<div className="empty"><FileText size={24} style={{margin:"auto auto 12px"}}/><p>Post testuale: lavora sulla didascalia e sul titolo.</p></div>}
   </div>
  </div>
 </div>;
}
function Results({data,onAction,onChat,busy}:{data:Snapshot;onAction:Props["onAction"];onChat:()=>void;busy:string|null}){
 const [requested,setRequested]=useState("");
 const selected=data.social_accounts.some(a=>a.id===requested)?requested:data.social_accounts[0]?.id;
 const stats=summarizeInstagram(data.social_snapshots,selected);
 const snap=stats.latest;
 const num=(x:number|null|undefined)=>x===null||x===undefined?"—":x.toLocaleString("it-IT");
 const maxFollowers=Math.max(1,...stats.history.map(p=>p.count));
 return <>
  <Header k="PERFORMANCE / MEMORIA" title="I risultati guidano la prossima scelta."
   sub="Metriche reali del singolo account, fonti tracciate e nessun numero simulato."
   actions={<div className="flex gap8 wrap"><a className="button" href={"/api/integrations/instagram/connect?clientId="+data.client.id}><Instagram size={16}/> Collega Instagram</a>
     <button className="button primary" disabled={!data.social_accounts.length||Boolean(busy)} onClick={()=>onAction("syncSocial")}><RefreshCw size={15}/> Sincronizza</button>
     {snap&&selected&&<a className="button" href={"/api/workspace/clients/"+data.client.id+"/reports/instagram?accountId="+encodeURIComponent(selected)} target="_blank" rel="noopener noreferrer"><FileText size={15}/> Esporta CSV</a>}</div>}/>
  {!data.social_accounts.length?<div className="notice warn">Instagram non è collegato. Per leggere dati veri è necessario un account Professional autorizzato su Meta.</div>:
   <div className="card"><div className="flex between center wrap gap12"><div><h2>Account Instagram</h2><p className="caption">La dashboard non mescola mai account differenti</p></div>
    <div className="flex center gap8 wrap">
     <select aria-label="Account Instagram" value={selected||""} onChange={e=>setRequested(e.target.value)} style={{maxWidth:240}}>
      {data.social_accounts.map(a=><option value={a.id} key={a.id}>@{a.username}</option>)}
     </select>
     <button className="button small" disabled={!selected||Boolean(busy)} onClick={()=>{
       if(window.confirm("Scollegare Instagram? Credenziali e statistiche locali verranno eliminate. Il consenso Meta remoto va revocato separatamente."))
         onAction("disconnectSocial",{id:selected});
     }}>Scollega</button>
    </div></div></div>}
  <div className="grid3" style={{marginTop:18}}>
   <div className="card metric-card"><span className="muted">Follower · ultima lettura</span>
    <strong>{num(stats.followers)}</strong><small>{stats.delta===null?"Variazione non disponibile":(stats.delta>=0?"+":"")+num(stats.delta)+" rispetto alla lettura precedente"}</small></div>
   <div className="card metric-card"><span className="muted">Contenuti dell&apos;account</span>
    <strong>{num(stats.media_count)}</strong><small>Conteggio riportato dall&apos;API Meta</small></div>
   <div className="card metric-card"><span className="muted">Interazioni del campione</span>
    <strong>{num(stats.total_sampled_interactions)}</strong><small>Like + commenti per {stats.sampled_posts_with_interactions} contenuti con dati disponibili</small></div>
  </div>
  <div className="grid2" style={{marginTop:18}}>
   <div className="card">
    <div className="section-title"><h2>Evoluzione follower</h2><span className="caption">{stats.history.length} rilevazioni storiche</span></div>
    {stats.history.length>=2?
      <div style={{display:"flex",alignItems:"end",gap:8,minHeight:105,padding:"15px 0 0"}} role="img" aria-label={"Storico follower: "+stats.history.map(p=>new Date(p.date).toLocaleDateString("it-IT")+" "+p.count).join(", ")}>
      {stats.history.map(p=><div key={p.date} style={{flex:1,minWidth:0,textAlign:"center"}}>
       <div title={p.count+" follower · "+new Date(p.date).toLocaleDateString("it-IT")} style={{height:Math.max(6,Math.round(p.count/maxFollowers*82)),borderRadius:"5px 5px 0 0",background:"var(--accent)",opacity:.75}}/>
       <small className="caption" style={{fontSize:10}}>{new Date(p.date).toLocaleDateString("it-IT",{day:"2-digit",month:"2-digit"})}</small>
      </div>)}</div>:
      <Empty title="Servono almeno due rilevazioni" text="Sincronizza nuovamente in un giorno successivo per confrontare valori reali."/>}
    <div className="separator"/>
    <div className="info-pair"><span>Ultima sincronizzazione</span><strong>{snap?new Date(snap.collected_at).toLocaleString("it-IT"):"—"}</strong></div>
    <div className="info-pair"><span>Copertura insight post disponibili</span><strong>{stats.sampled_posts_with_reach===null?"Non disponibile":stats.sampled_posts_with_reach+" su "+stats.sampled_posts}</strong></div>
    {snap?.data.insights_status==="unavailable"&&<div className="notice warn">Gli insight avanzati non sono disponibili per questo account o per i permessi correnti. Like, commenti e follower rimangono utilizzabili.</div>}
   </div>
   <div className="card">
    <div className="section-title"><h2>Contenuti con più interazioni</h2><span className="caption">Ultimo campione Meta</span></div>
    {stats.top.length?stats.top.map((p,i)=><div className="list-row" key={p.id}>
      <div className="stack" style={{gap:4,minWidth:0}}>
       <strong>{i+1}. {p.caption?.slice(0,85)||p.media_type||"Post Instagram"}</strong>
       <div className="caption">{num(p.likes)} like · {num(p.comments)} commenti · {num(p.interactions)} interazioni</div>
       {(p.reach!==null||p.saves!==null||p.shares!==null)&&<div className="caption">{p.reach!==null?"Copertura "+num(p.reach)+" · ":""}{p.saves!==null?"Salvataggi "+num(p.saves)+" · ":""}{p.shares!==null?"Condivisioni "+num(p.shares):""}</div>}
      </div>
      {p.permalink&&<a target="_blank" rel="noreferrer" href={p.permalink} aria-label="Apri su Instagram"><ExternalLink size={15}/></a>}
     </div>):<Empty title="Nessun contenuto con dati utilizzabili" text="Collega e sincronizza un account professionale per ottenere contenuti reali."/>}
   </div>
  </div>
  <div className="grid2" style={{marginTop:18}}>
   <div className="card">
    <div className="section-title"><h2>Decisioni da prendere con il Leader</h2></div>
    <p className="tagline">Le metriche sono un punto di partenza: valuta il pubblico, la copertura degli insight, gli obiettivi del cliente e il contesto prima di modificare la strategia.</p>
    <div className="info-pair"><span>Media interazioni per post rilevabile</span><strong>{stats.average_interactions===null?"—":num(Math.round(stats.average_interactions))}</strong></div>
    <div className="caption" style={{marginTop:10}}>Questo non è il tasso di engagement e il campione dei post non rappresenta necessariamente un periodo specifico. I dati mancanti non sono considerati zero.</div>
    <button className="button primary" style={{marginTop:16}} onClick={onChat}><Sparkles size={15}/> Analizza con il Leader</button>
   </div>
   <div className="card"><h2 style={{marginBottom:14}}>Storico delle campagne</h2>
    {data.campaigns.length?data.campaigns.slice(0,8).map(c=><div className="list-row" key={c.id}><div><strong>{c.title}</strong><div className="caption">{c.period} · {c.objective.slice(0,90)}</div></div><Badge value={c.status}/></div>):
    <Empty title="Non ci sono ancora campagne" text="Le campagne approvate potranno usare questi dati come riferimento."/>}
    <div className="notice" style={{marginTop:14}}>I dati Instagram non dimostrano l&apos;efficacia causale di una campagna. Attribuzione e confronto richiedono un periodo e KPI definiti.</div>
   </div>
  </div>
 </>;
}
