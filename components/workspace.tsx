"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { Activity,BookOpen,BriefcaseBusiness,Check,ChevronDown,ChevronRight,FileText,FolderKanban,LayoutDashboard,LoaderCircle,LogOut,Menu,MessageCircle,Package,Plus,Send,Settings2,ShieldCheck,Sparkles,Users,X } from "lucide-react";
import Views from "./views";
import type { Client,Offer,Snapshot,View,Mission } from "./types";
import { initials,requestJson,statusLabel } from "./types";
import { browserDb } from "@/lib/supabase-browser";

type Modal={kind:string;item?:unknown}|null;
const nav:Array<{key:View;label:string;icon:typeof LayoutDashboard}>=[
 {key:"today",label:"Oggi",icon:LayoutDashboard},
 {key:"knowledge",label:"Biblioteca",icon:BookOpen},
 {key:"offers",label:"Offerta",icon:Package},
 {key:"projects",label:"Progetti",icon:FolderKanban},
 {key:"results",label:"Risultati",icon:Activity}
];
const endpoint=(id:string)=>"/api/workspace/clients/"+id;
function getError(error:unknown){return error instanceof Error?error.message:"Operazione non riuscita"}
export default function Workspace(){
 const [clients,setClients]=useState<Client[]>([]);
 const [clientId,setClientId]=useState<string|null>(null);
 const [data,setData]=useState<Snapshot|null>(null);
 const [view,setView]=useState<View>("today");
 const [modal,setModal]=useState<Modal>(null);
 const [switchOpen,setSwitchOpen]=useState(false);
 const [chatOpen,setChatOpen]=useState(false);
 const [chatText,setChatText]=useState("");
 const [busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState("");
 const [toast,setToast]=useState("");
 const [email,setEmail]=useState("");
 const currentId=useRef<string|null>(null);
 const [loading,setLoading]=useState(true);
 const railEnd=useRef<HTMLDivElement|null>(null);

 const flash=(msg:string)=>{setToast(msg);window.setTimeout(()=>setToast(""),4200)};
 const refresh=useCallback(async(id:string)=>{
   const snapshot=await requestJson<Snapshot>(endpoint(id));
   if(currentId.current===id)setData(snapshot);
 },[]);
 const choose=(id:string)=>{
   if(!clients.some(c=>c.id===id))return;
   currentId.current=id;setClientId(id);setData(null);setSwitchOpen(false);setChatText("");
   setView("today");setChatOpen(false);
   window.localStorage.setItem("forgecy-active-client",id);
   const url=new URL(window.location.href);url.searchParams.set("clientId",id);url.searchParams.delete("integration");
   window.history.replaceState(null,"",url);
 };
 useEffect(()=>{
   let active=true;
   (async()=>{
    try{
     const r=await requestJson<{clients:Client[]}>("/api/workspace/clients");
     if(!active)return;
     setClients(r.clients);
     const query=new URLSearchParams(window.location.search).get("clientId");
     const stored=window.localStorage.getItem("forgecy-active-client");
     const chosen=[query,stored,r.clients[0]?.id].find(id=>r.clients.some(c=>c.id===id));
     if(chosen){currentId.current=chosen;setClientId(chosen);}
     try{const db=browserDb();const {data}=await db.auth.getUser();if(active)setEmail(data.user?.email||"");}catch{}
     const integration=new URLSearchParams(window.location.search).get("integration");
     if(integration)flash(integration);
    }catch(e){if(active)setError(getError(e));}
    finally{if(active)setLoading(false);}
   })();
   return()=>{active=false};
 },[]);
 useEffect(()=>{if(!clientId)return;let active=true;
  refresh(clientId).catch(e=>{if(active)setError(getError(e))});
  return()=>{active=false};
 },[clientId,refresh]);
 useEffect(()=>{railEnd.current?.scrollIntoView({behavior:"smooth",block:"end"})},[data?.messages.length,chatOpen]);

 async function reloadAll(){
  const result=await requestJson<{clients:Client[]}>("/api/workspace/clients");setClients(result.clients);
  if(clientId)await refresh(clientId);
 }
 async function mutate<T>(name:string,work:()=>Promise<T>,success?:string):Promise<T|undefined>{
  if(busy)return undefined;
  setBusy(name);setError("");
  try{const res=await work();if(clientId)await reloadAll();if(success)flash(success);return res;}
  catch(e){setError(getError(e));return undefined;}
  finally{setBusy(null);}
 }
 async function onAction(name:string,body:Record<string,unknown>={}):Promise<unknown>{
  if(!clientId)return;
  const root=endpoint(clientId);
  if(name==="deleteSignal")return mutate(name,()=>requestJson(root+"/signals/"+body.id,{method:"DELETE"}),"Osservazione eliminata");
  if(name==="dossierDraft")return mutate(name,()=>requestJson(root+"/dossier/draft",{method:"POST",body:"{}"}),"Dossier generato: controllalo prima di approvare");
  if(name==="dossierApprove")return mutate(name,()=>requestJson(root+"/dossier/approve",{method:"POST",body:JSON.stringify(body)}),"Dossier approvato");
  if(name==="verifyOffer")return mutate(name,()=>requestJson(root+"/offers/"+body.id,{method:"PATCH",body:JSON.stringify({status:"verified"})}),"Offerta verificata: rivedi il dossier");
  if(name==="updateContent")return mutate(name,()=>requestJson(root+"/contents/"+body.id,{method:"PATCH",body:JSON.stringify({title:body.title,caption:body.caption,slides:body.slides,editorial_brief:body.editorial_brief,...(body.status?{status:body.status}:{})})}),"Contenuto salvato");
  if(name==="revalidateContent")return mutate(name,()=>requestJson(root+"/contents/"+body.id+"/revalidate",{method:"POST",body:"{}"}),"Bozza riaperta: verifica i dati e richiedi l’approvazione");
  if(name==="adapt")return mutate(name,()=>requestJson(root+"/contents/"+body.id+"/adapt",{method:"POST",body:"{}"}),"Variante LinkedIn creata");
  if(name==="image")return mutate(name,()=>requestJson(root+"/contents/"+body.id+"/image",{method:"POST",body:JSON.stringify({slideIndex:body.slideIndex,prompt:body.prompt})}),"Immagine generata e salvata");
  if(name==="syncSocial")return mutate(name,()=>requestJson(root+"/social/sync",{method:"POST",body:"{}"}),"Dati Instagram aggiornati");
  if(name==="approveMission"){
    const response=await mutate<{campaign_id:string}>(name,()=>requestJson(root+"/missions/"+body.id+"/approve",{method:"POST",body:"{}"}),"Campagna creata dalla proposta");
    if(response){setView("projects");setChatOpen(false)}
    return response;
  }
  if(name==="rejectMission")return mutate(name,()=>requestJson(root+"/missions/"+body.id+"/reject",{method:"POST",body:"{}"}),"Proposta scartata");
  if(name==="newMission")return mutate(name,()=>requestJson(root+"/missions",{method:"POST",body:JSON.stringify(body)}),"Il team ha preparato una proposta da approvare");
 }
 async function createClient(e:React.FormEvent<HTMLFormElement>){
   e.preventDefault();const form=new FormData(e.currentTarget);
   const name=String(form.get("name")||"").trim();
   const payload={name,industry:String(form.get("industry")||""),website:String(form.get("website")||"")};
   const result=await mutate<{client:Client}>("createClient",()=>requestJson("/api/workspace/clients",{method:"POST",body:JSON.stringify(payload)}));
   if(result){setClients(cs=>cs.some(c=>c.id===result.client.id)?cs:[result.client,...cs]);currentId.current=result.client.id;setClientId(result.client.id);setModal(null);flash("Cliente creato");}
 }
 async function submitModal(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!clientId||!modal)return;
  const f=new FormData(e.currentTarget),root=endpoint(clientId),kind=modal.kind;
  const item=(modal.item||{}) as Record<string,unknown>;
  let url="",method="POST",payload:Record<string,unknown>={};
  if(kind==="source"){
   const sourceKind=String(f.get("kind")||"note");
   const siteUrl=String(f.get("url")||"").trim();
   if(sourceKind==="website"&&f.get("auto")==="on"){
     url=root+"/website";payload={url:siteUrl};
   }else{
     url=root+"/sources";payload={kind:sourceKind,title:String(f.get("title")||siteUrl||"Nuova fonte"),url:siteUrl||undefined,body:String(f.get("body")||"")};
   }
  }else if(kind==="signal"){
   url=root+"/signals";
   payload={
    platform:String(f.get("platform")||"instagram"),
    kind:String(f.get("kind")||"comment"),
    topic:String(f.get("topic")||"").trim(),
    excerpt:String(f.get("excerpt")||"").trim(),
    audience_need:String(f.get("audience_need")||"").trim(),
    context:String(f.get("context")||"").trim(),
    source_url:String(f.get("source_url")||"").trim()||null,
    ...(String(f.get("observed_at")||"")?{observed_at:String(f.get("observed_at"))}:{})
   };
  }else if(kind==="offer"){
   url=root+"/offers"+(item.id?"/"+item.id:"");method=item.id?"PATCH":"POST";
   const priceText=String(f.get("price")||"").trim().replace(",",".");
   payload={
    kind:String(f.get("kind")||"service"),name:String(f.get("name")||"").trim(),
    description:String(f.get("description")||""),audience:String(f.get("audience")||""),
    benefits:String(f.get("benefits")||"").split("\n").map(x=>x.trim()).filter(Boolean),
    price:priceText?Number(priceText):null,currency:"EUR",cta:String(f.get("cta")||""),
    status:item.id?(item.status||"draft"):"draft"
   };
  }else if(kind==="profile"){
   url=root;method="PATCH";
   payload={name:String(f.get("name")||""),industry:String(f.get("industry")||""),website:String(f.get("website")||""),
    profile:{...(data?.client.profile||{}),description:String(f.get("description")||""),tone:String(f.get("tone")||""),brand_primary:String(f.get("brand_primary")||"#244536"),brand_background:String(f.get("brand_background")||"#dce5d9"),heading_font:String(f.get("heading_font")||"").slice(0,100)}};
  }else if(kind==="campaign"){
   url=root+"/campaigns";payload={title:String(f.get("title")||""),objective:String(f.get("objective")||""),period:String(f.get("period")||""),
    offer_id:String(f.get("offer_id")||"")||null};
  }else if(kind==="content"){
   url=root+"/contents";payload={campaign_id:item.campaign_id,title:String(f.get("title")||""),channel:String(f.get("channel")||"instagram"),format:String(f.get("format")||"post"),caption:String(f.get("caption")||"")};
  }else if(kind==="mission"){
   setChatOpen(true);
   const offer=String(f.get("offer_id")||"");
   const result=await onAction("newMission",{request:String(f.get("request")||""),period:String(f.get("period")||"Prossimi 30 giorni"),offer_id:offer||null});
   if(result)setModal(null);
   return;
  }else if(kind==="upload"){
   const file=f.get("file");if(!(file instanceof File)){setError("Seleziona un file");return}
   const form=new FormData();form.set("file",file);
   const result=await mutate("upload",()=>requestJson(root+"/upload",{method:"POST",body:form}),"Documento caricato");
   if(result)setModal(null);return;
  }else return;
  const result=await mutate(kind,()=>requestJson(url,{method,body:JSON.stringify(payload)}),"Operazione completata");
  if(result)setModal(null);
 }
 async function sendMessage(e:React.FormEvent){
  e.preventDefault();if(!clientId||!chatText.trim())return;
  const body=chatText.trim();setChatText("");
  const result=await mutate("chat",()=>requestJson(endpoint(clientId)+"/messages",{method:"POST",body:JSON.stringify({body})}));
  if(!result)setChatText(body);
 }
 async function logout(){
  try{await browserDb().auth.signOut()}finally{window.location.assign("/login")}
 }
 const current=clients.find(c=>c.id===clientId);
 const latestDossier=data?.dossiers?.[0];
 const canCampaign=latestDossier?.status==="approved" && latestDossier.knowledge_revision===data?.client.knowledge_revision;
 const pendingMissions=(data?.missions||[]).filter(x=>x.status==="proposed");
 const baseModal=()=>setModal({kind:"client"});

 if(loading)return <main className="login-panel" style={{minHeight:"100vh"}}><div className="stack"><LoaderCircle className="spin"/> Caricamento Forgecy…</div></main>;
 if(error && !clients.length)return <main className="login-panel" style={{minHeight:"100vh"}}><div className="card stack"><h2>Forgecy non è ancora configurato</h2><p className="tagline">{error}</p><p className="caption">Configura Supabase ed esegui le migration seguendo il README.</p><a className="button" href="/login">Vai all'accesso</a></div></main>;
 return <>
  <div className="app-shell">
   <aside className="sidebar">
    <div className="wordmark"><span className="logo-icon">f.</span><strong>forgecy</strong></div>
    <div className="nav-label">IL TUO WORKSPACE</div>
    <nav className="side-nav">{nav.map(n=><button key={n.key} className={"side-link "+(view===n.key?"active":"")} onClick={()=>setView(n.key)}><n.icon size={18}/>{n.label}</button>)}</nav>
    <div className="sidebar-bottom">
     <button className="side-link" onClick={()=>setChatOpen(true)}><Sparkles size={17}/> Leader AI</button>
     <div className="separator"/>
     <button className="client-switch" onClick={()=>setSwitchOpen(x=>!x)}>
      <div className="client-avatar">{current?initials(current.name):<Users size={17}/>}</div>
      <span style={{minWidth:0,flex:1}}><strong>{current?.name||"Scegli cliente"}</strong><small>Cambia profilo</small></span><ChevronDown size={15}/>
     </button>
     {switchOpen&&<div className="switch-popover"><div className="eyebrow" style={{margin:"6px 8px 10px"}}>SELEZIONA CLIENTE</div>
      {clients.map(c=><button key={c.id} onClick={()=>choose(c.id)}><span className="client-avatar">{initials(c.name)}</span><span style={{flex:1}}><strong>{c.name}</strong><small style={{display:"block"}}>{c.industry}</small></span>{c.id===clientId&&<Check size={16}/>}</button>)}
      <div className="separator"/><button onClick={()=>{setSwitchOpen(false);baseModal()}}><Plus size={17}/> Nuovo cliente</button><button onClick={logout}><LogOut size={16}/> Esci {email?"("+email.split("@")[0]+")":""}</button>
     </div>}
    </div>
   </aside>
   <div className="main-area">
    <div className="topbar">
     <div className="flex center gap8"><button className="mobile-client-button" onClick={()=>setSwitchOpen(x=>!x)}>{current?initials(current.name):"＋"} <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{current?.name||"Scegli cliente"}</span><ChevronDown size={13}/></button><span className="muted" style={{fontSize:12}}>Workspace <ChevronRight size={12} style={{display:"inline"}}/> {nav.find(n=>n.key===view)?.label}</span></div>
     <div className="flex center gap8"><span className="pill muted" style={{maxWidth:190,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{current?.name||"Nessun cliente"}</span><button className="button small mobile-chat-toggle" onClick={()=>setChatOpen(true)}><MessageCircle size={15}/> Chat</button></div>
    </div>
    <main className="page-scroll"><div className="page-body">
     {error&&<div className="notice error" role="alert" style={{marginBottom:18,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>{error}<button className="button small" onClick={()=>setError("")}>Chiudi</button></div>}
     {!current?<div className="stack-lg" style={{maxWidth:640,margin:"10vh auto"}}>
      <div className="eyebrow">BENVENUTO IN FORGECY</div><h1>Il lavoro inizia da un cliente.</h1><p className="tagline">Crea uno spazio dedicato: potrai aggiungere sito, fonti, prodotti e servizi, costruire un dossier approvato e parlare con il Leader.</p>
      <div><button className="button primary" onClick={baseModal}><Plus size={16}/> Crea il primo cliente</button></div>
     </div>:!data?<div className="empty">Caricamento dati di {current.name}…</div>:
      <Views data={data} view={view} onView={setView} onModal={(kind,item)=>setModal({kind,item})} onAction={onAction} onChat={()=>setChatOpen(true)} busy={busy}/>}
    </div></main>
   </div>
   <aside className={"chat-panel "+(chatOpen?"open":"")}>
    <div className="chat-head"><div className="chat-title"><span className="avatar-square" style={{width:36,height:36}}><Sparkles size={19}/></span><span>Leader AI <small style={{display:"block",fontWeight:500}}>{current?.name||"Seleziona un cliente"}</small></span></div>
     <button className="button small ghost mobile-chat-toggle" aria-label="Chiudi chat" onClick={()=>setChatOpen(false)}><X size={18}/></button></div>
    <div className="chat-message-list">
     <div className="chat-bubble leader">Ciao! Sono il Leader di Forgecy. Conosco esclusivamente le informazioni del cliente attivo. Posso rispondere a domande o coordinare una campagna con un'approvazione esplicita.</div>
     {data?.messages?.map(m=><div key={m.id} style={{display:"contents"}}>
      <div className={"chat-bubble "+(m.role==="user"?"user":"leader")}>{m.body}</div>
      {m.role==="leader"&&m.metadata?.kind==="signal_proposal"&&m.metadata.signal&&<button style={{alignSelf:"flex-start"}} className="button small" onClick={()=>setModal({kind:"signal",item:m.metadata?.signal})}><Check size={14}/> Rivedi e registra il feedback</button>}
     </div>)}
     {pendingMissions.map(m=><div className="mission-card" key={m.id}>
      <span className="pill warn" style={{alignSelf:"start"}}>PROPOSTA DEL TEAM</span><strong>{m.request}</strong>
      <p>{((m.payload as Record<string,unknown>).campaign as Record<string,unknown>|undefined)?.title as string||"Piano di campagna pronto"}</p>
      <div className="caption">{data?.agent_events.filter(x=>x.mission_id===m.id).length||0} passaggi tra agenti registrati</div>
      <div className="stack" style={{gap:2}}>{data?.agent_events.filter(x=>x.mission_id===m.id).slice(-4).map(ev=><div className="agent-event" key={ev.id}>{ev.agent} → {ev.recipient}: {ev.summary}</div>)}</div>
      <div className="flex gap8"><button className="button primary small" disabled={Boolean(busy)} onClick={()=>onAction("approveMission",{id:m.id})}><Check size={14}/> Approva</button><button className="button small" disabled={Boolean(busy)} onClick={()=>onAction("rejectMission",{id:m.id})}>Scarta</button></div>
     </div>)}
     <div ref={railEnd}/>
    </div>
    {current&&<div className="chat-prompt"><div className="eyebrow">AZIONI RAPIDE</div>
     <button className="button small" style={{justifyContent:"start"}} disabled={Boolean(busy)} onClick={()=>setModal({kind:"signal"})}><Plus size={14}/> Registra un feedback della community</button>
     <button className="button small" style={{justifyContent:"start"}} disabled={!canCampaign||Boolean(busy)} onClick={()=>setModal({kind:"mission"})}><Sparkles size={14}/> Proponi una campagna completa</button>
     {!canCampaign&&<span className="caption">Per generare campagne devi prima approvare il dossier aziendale aggiornato.</span>}
    </div>}
    <form className="chat-compose" onSubmit={sendMessage}><textarea value={chatText} disabled={!current||Boolean(busy)} onChange={e=>setChatText(e.target.value)} placeholder={current?"Chiedi qualsiasi cosa sul cliente…":"Prima seleziona un cliente"} maxLength={4000} rows={3}/>
     <div className="chat-footer"><button type="button" className="button small" disabled={!current||Boolean(busy)} onClick={()=>setModal({kind:"upload"})}><Plus size={14}/> Allega file</button><span className="caption">{busy?"Elaborazione…":"OpenRouter"}</span><button className="button primary small" type="submit" disabled={!chatText.trim()||!current||Boolean(busy)}><Send size={15}/> Invia</button></div>
    </form>
   </aside>
  </div>
  <nav className="mobile-bottom">{[nav[0],nav[1],nav[2],nav[3]].map(n=><button key={n.key} className={view===n.key?"active":""} onClick={()=>{setView(n.key);setChatOpen(false)}}><n.icon size={19}/>{n.label}</button>)}<button className={view==="results"?"active":""} onClick={()=>{setView("results");setChatOpen(false)}}><Activity size={19}/>Risultati</button></nav>
  {switchOpen&&<div className="switch-popover mobile-switch"><div className="eyebrow" style={{padding:8}}>CLIENTI</div>{clients.map(c=><button key={c.id} onClick={()=>choose(c.id)}><span className="client-avatar">{initials(c.name)}</span>{c.name}</button>)}<button onClick={()=>{setSwitchOpen(false);baseModal()}}><Plus size={14}/> Nuovo cliente</button><button onClick={logout}><LogOut size={14}/> Esci</button></div>}
  {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><div className="modal"><div className="modal-head"><div><div className="eyebrow">FORGECY / {current?.name||"NUOVO CLIENTE"}</div><h2 style={{marginTop:7}}>{({client:"Aggiungi un cliente",source:"Nuova fonte",signal:"Ascolto della community",upload:"Carica documento",offer:"Prodotto o servizio",profile:"Profilo del cliente",campaign:"Nuova campagna",content:"Nuovo contenuto",mission:"Affida un obiettivo al Leader"} as Record<string,string>)[modal.kind]||"Nuovo elemento"}</h2></div><button className="button ghost small" aria-label="Chiudi" onClick={()=>setModal(null)}><X size={18}/></button></div>
   <form onSubmit={modal.kind==="client"?createClient:submitModal}>
    {modal.kind==="client"&&<><div><label>Nome del cliente *</label><input required name="name" autoFocus maxLength={160} placeholder="Es. CasaLuce"/></div><div className="cols"><div><label>Settore</label><input name="industry" placeholder="Es. Cura della casa"/></div><div><label>Sito web</label><input name="website" placeholder="https://azienda.it"/></div></div></>}
    {modal.kind==="profile"&&<><div><label>Nome</label><input required name="name" defaultValue={current?.name}/></div><div className="cols"><div><label>Settore</label><input name="industry" defaultValue={current?.industry}/></div><div><label>Sito web</label><input name="website" defaultValue={current?.website||""}/></div></div><div><label>Descrizione</label><textarea name="description" rows={4} defaultValue={String(data?.client.profile?.description||"")}/></div><div><label>Tono di voce</label><textarea name="tone" rows={2} defaultValue={String(data?.client.profile?.tone||"")}/></div>
      <div className="cols">
       <div><label>Colore principale</label><input name="brand_primary" type="color" defaultValue={String(data?.client.profile?.brand_primary||"#244536")}/></div>
       <div><label>Colore di sfondo</label><input name="brand_background" type="color" defaultValue={String(data?.client.profile?.brand_background||"#dce5d9")}/></div>
      </div>
      <div><label>Font del brand (nome di riferimento)</label><input name="heading_font" maxLength={100} defaultValue={String(data?.client.profile?.heading_font||"")} placeholder="Es. Recoleta, Cinzel, Inter…"/><p className="caption" style={{marginTop:5}}>Il font è un riferimento per il designer: prima di usarlo nelle esportazioni serve un file con licenza adeguata.</p></div></>}
    {modal.kind==="signal"&&<>
     <div className="notice">Registra feedback anonimizzati. Evita dati personali e chiarisci da dove arriva l'osservazione: un segnale isolato è un'ipotesi, non una statistica.</div>
     <div className="cols">
      <div><label>Piattaforma</label><select name="platform" defaultValue={String((modal.item as Record<string,unknown>|undefined)?.platform||"instagram")}><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option><option value="review">Recensioni</option><option value="website">Sito / FAQ</option><option value="support">Assistenza</option><option value="other">Altra fonte</option></select></div>
      <div><label>Tipo di segnale</label><select name="kind" defaultValue={String((modal.item as Record<string,unknown>|undefined)?.kind||"comment")}><option value="comment">Commento</option><option value="question">Domanda</option><option value="objection">Obiezione</option><option value="review">Recensione</option><option value="faq">FAQ</option><option value="dm">Messaggio privato anonimizzato</option><option value="other">Altro</option></select></div>
     </div>
     <div><label>Argomento comune *</label><input name="topic" required minLength={2} defaultValue={String((modal.item as Record<string,unknown>|undefined)?.topic||"")} maxLength={160} placeholder="Es. Come scegliere l'ammorbidente"/></div>
     <div><label>Osservazione / domanda anonimizzata *</label><textarea name="excerpt" required minLength={5} defaultValue={String((modal.item as Record<string,unknown>|undefined)?.excerpt||"")} maxLength={2500} rows={4} placeholder="Es. Molti chiedono se il prodotto è adatto ai tessuti delicati."/></div>
     <div><label>Quale bisogno potrebbe rivelare?</label><textarea name="audience_need" maxLength={1000} defaultValue={String((modal.item as Record<string,unknown>|undefined)?.audience_need||"")} rows={2} placeholder="Es. Capire se il prodotto è delicato sui capi"/></div>
     <div className="cols"><div><label>Link alla fonte (se pubblico)</label><input name="source_url" type="url" defaultValue={String((modal.item as Record<string,unknown>|undefined)?.source_url||"")} placeholder="https://..."/></div><div><label>Data dell'osservazione</label><input name="observed_at" type="date"/></div></div>
     <div><label>Contesto (facoltativo)</label><textarea name="context" maxLength={1200} defaultValue={String((modal.item as Record<string,unknown>|undefined)?.context||"")} rows={2} placeholder="A quale post, prodotto o discussione si riferisce?"/></div>
    </>}
    {modal.kind==="source"&&<><div><label>Tipo di fonte</label><select name="kind" defaultValue="note"><option value="note">Nota / Brief</option><option value="website">Sito web</option><option value="social">Profilo social (riferimento)</option></select></div><div><label>Titolo</label><input name="title" placeholder="Es. Brief commerciale"/></div><div><label>URL (opzionale)</label><input name="url" type="url" placeholder="https://esempio.it"/></div><div><label>Contenuto / annotazioni</label><textarea name="body" rows={5} placeholder="Informazioni attendibili, prodotti, tone of voice, obiettivi…"/></div><label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500}}><input type="checkbox" name="auto"/> Acquisisci automaticamente da HTTPS (richiede crawler abilitato)</label></>}
    {modal.kind==="upload"&&<><div><label>Documento del cliente (max 10 MB)</label><input type="file" name="file" required accept=".txt,.md,.csv,.pdf,.png,.jpg,.jpeg,.webp"/></div><div className="notice warn">Testi, Markdown e CSV sono letti subito. PDF e immagini vengono archiviati privatamente ma richiedono estrazione testo aggiuntiva per l'analisi AI.</div></>}
    {modal.kind==="offer"&&(()=>{
      const o=(modal.item||{}) as Partial<Offer>;
      return <><div className="cols"><div><label>Tipologia</label><select name="kind" defaultValue={o.kind||"service"}><option value="product">Prodotto fisico</option><option value="service">Servizio</option></select></div><div><label>Prezzo EUR (vuoto = preventivo)</label><input name="price" inputMode="decimal" defaultValue={o.price??""} placeholder="19.90"/></div></div><div><label>Nome prodotto / servizio *</label><input required name="name" defaultValue={o.name||""}/></div><div><label>Descrizione</label><textarea rows={4} name="description" defaultValue={o.description||""}/></div><div><label>Pubblico</label><input name="audience" defaultValue={o.audience||""}/></div><div><label>Benefici verificabili (uno per riga)</label><textarea name="benefits" rows={4} defaultValue={(o.benefits||[]).join("\n")}/></div><div><label>Call to action</label><input name="cta" defaultValue={o.cta||""} placeholder="Scopri di più"/></div></>;
     })()}
    {modal.kind==="campaign"&&<><div><label>Nome campagna *</label><input required name="title"/></div><div><label>Obiettivo *</label><textarea required name="objective" rows={3}/></div><div><label>Periodo *</label><input required name="period" placeholder="Settembre 2027"/></div><div><label>Prodotto / servizio da promuovere</label><select name="offer_id" defaultValue={String((modal.item as Record<string,unknown>)?.offer_id||"")}><option value="">Campagna istituzionale</option>{data?.offers.filter(o=>o.status==="verified").map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></div></>}
    {modal.kind==="content"&&<><div><label>Titolo *</label><input required name="title"/></div><div className="cols"><div><label>Canale</label><select name="channel"><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option></select></div><div><label>Formato</label><select name="format"><option value="post">Post statico</option><option value="carousel">Carosello Instagram</option><option value="document">Documento LinkedIn</option></select></div></div><div><label>Didascalia</label><textarea name="caption" rows={4}/></div></>}
    {modal.kind==="mission"&&<><div className="notice">Il Leader coordinerà Analyst, Strategist, Copywriter, Art Director e Brand Guard. Prima di creare contenuti ti presenterà una proposta da approvare.</div><div><label>Che cosa vuoi ottenere? *</label><textarea required minLength={8} rows={4} name="request" placeholder="Per settembre voglio promuovere gli ammorbidenti: costruisci una campagna Instagram e adatta i post per LinkedIn."/></div><div><label>Periodo</label><input name="period" defaultValue="Prossimi 30 giorni"/></div><div><label>Offerta da promuovere</label><select name="offer_id"><option value="">Nessuna offerta specifica</option>{data?.offers.filter(o=>o.status==="verified").map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></div></>}
    <div className="form-footer"><button type="button" className="button" onClick={()=>setModal(null)}>Annulla</button><button disabled={Boolean(busy)} type="submit" className="button primary">{busy?"Elaborazione…":modal.kind==="mission"?"Avvia team AI":"Salva"}</button></div>
   </form>
  </div></div>}
  {toast&&<div className="toast" role="status">{toast}</div>}
 </>;
}
