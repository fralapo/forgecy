"use client";
import {useMemo,useState} from "react";
import {CalendarDays,CheckCircle2,Clock,Plus,Trash2} from "lucide-react";
import type {Snapshot,EditorialEntry} from "./types";

type Props={
 data:Snapshot;
 onAction:(name:string,body?:Record<string,unknown>)=>Promise<unknown>;
 busy:string|null;
};
const statusNames:Record<EditorialEntry["status"],string>={
 idea:"Idea",planned:"Pianificato",ready:"Pronto",completed:"Completato",cancelled:"Annullato"
};
const formatDate=(v:string)=>new Date(v).toLocaleString("it-IT",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
function localInputValue(date:Date){
 const d=new Date(date.getTime()-date.getTimezoneOffset()*60_000);
 return d.toISOString().slice(0,16);
}
export default function EditorialCalendar({data,onAction,busy}:Props){
 const [adding,setAdding]=useState(false);
 const [title,setTitle]=useState("");
 const [channel,setChannel]=useState<EditorialEntry["channel"]>("instagram");
 const [plannedAt,setPlannedAt]=useState(()=>localInputValue(new Date(Date.now()+86_400_000)));
 const [status,setStatus]=useState<EditorialEntry["status"]>("planned");
 const [notes,setNotes]=useState("");
 const [contentId,setContentId]=useState("");
 const [period,setPeriod]=useState("all");
 const linked=data.contents.filter(item=>item.channel===channel&&item.status!=="stale");
 const dates=useMemo(()=>[...data.editorial_entries].filter(item=>{
   if(period==="all")return true;
   const d=new Date(item.planned_at),today=new Date();
   if(period==="future")return d>=new Date(today.getFullYear(),today.getMonth(),today.getDate());
   return d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth();
 }).sort((a,b)=>Date.parse(a.planned_at)-Date.parse(b.planned_at)),[data.editorial_entries,period]);
 const collides=(entry:EditorialEntry)=>data.editorial_entries.some(other=>
   other.id!==entry.id&&other.status!=="cancelled"&&entry.status!=="cancelled"&&
   other.channel===entry.channel&&Math.abs(Date.parse(other.planned_at)-Date.parse(entry.planned_at))<30*60_000
 );
 async function create(e:React.FormEvent<HTMLFormElement>){
   e.preventDefault();
   const date=new Date(plannedAt);
   if(!Number.isFinite(date.getTime()))return;
   const result=await onAction("calendarCreate",{
     title,channel,planned_at:date.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC",notes,
     status,content_id:contentId||null
   });
   if(result){setAdding(false);setTitle("");setNotes("");setContentId("");}
 }
 return <div className="stack-lg">
   <div className="flex between center gap12 wrap">
     <div><div className="eyebrow">PROGETTI / CALENDARIO</div>
      <h2 style={{fontSize:24,marginTop:6}}>Piano editoriale</h2>
      <p className="tagline" style={{marginTop:6}}>Pianifica le uscite per canale, collega i contenuti e controlla lo stato di preparazione.</p>
     </div>
     <button className="button primary" disabled={Boolean(busy)} onClick={()=>setAdding(v=>!v)}>
       <Plus size={16}/>{adding?"Chiudi modulo":"Pianifica contenuto"}
     </button>
   </div>
   <div className="notice">Le date sono indicative per il team. Pianificare una voce non pubblica nulla sui social: la pubblicazione richiede un'integrazione autorizzata.</div>
   {adding&&<form className="card stack" onSubmit={create}>
     <h2>Nuova uscita editoriale</h2>
     <label htmlFor="editorial-title">Titolo *</label>
     <input required maxLength={240} id="editorial-title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Es. Carosello: 5 consigli per il cliente"/>
     <div className="cols">
      <div><label htmlFor="editorial-channel">Canale</label>
       <select id="editorial-channel" value={channel} onChange={e=>{setChannel(e.target.value as EditorialEntry["channel"]);setContentId("");}}>
        <option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option>
        <option value="facebook">Facebook</option><option value="website">Sito web</option>
        <option value="email">Email</option>
       </select></div>
      <div><label htmlFor="editorial-when">Data e ora</label>
       <input type="datetime-local" required id="editorial-when" value={plannedAt} onChange={e=>setPlannedAt(e.target.value)}/></div>
     </div>
     <div className="cols">
      <div><label htmlFor="editorial-status">Stato</label>
       <select id="editorial-status" value={status} onChange={e=>setStatus(e.target.value as EditorialEntry["status"])}>
       {(["idea","planned","ready"] as const).map(x=><option value={x} key={x}>{statusNames[x]}</option>)}
       </select></div>
      <div><label htmlFor="editorial-content">Contenuto collegato</label>
       <select id="editorial-content" value={contentId} onChange={e=>setContentId(e.target.value)}>
        <option value="">Nessuno (idea o brief)</option>
        {linked.map(item=><option value={item.id} key={item.id}>{item.title}</option>)}
       </select></div>
     </div>
     <label htmlFor="editorial-notes">Note operative</label>
     <textarea maxLength={4000} id="editorial-notes" value={notes} onChange={e=>setNotes(e.target.value)} rows={3} placeholder="Obiettivo, formato, consegna, materiali necessari…"/>
     <div><button className="button primary" type="submit" disabled={Boolean(busy)||!title.trim()}>Salva nel calendario</button></div>
   </form>}
   <div className="flex between center wrap gap12">
     <div className="flex gap8 wrap">
      {([["all","Tutti"],["month","Questo mese"],["future","Da oggi"]] as const).map(([key,label])=>
      <button className={"button small "+(period===key?"primary":"")} key={key} onClick={()=>setPeriod(key)}>{label}</button>)}
     </div>
     <div className="caption">{dates.length} voci visibili · {data.editorial_entries.filter(x=>x.status==="ready").length} pronte</div>
   </div>
   {dates.length===0?<div className="card"><div className="empty"><CalendarDays size={28} style={{margin:"auto auto 10px"}}/><h2>Nessuna uscita pianificata</h2><p>Inserisci una prima data o chiedi al Leader di preparare i contenuti della campagna.</p></div></div>:
    <div className="card">
      {dates.map(item=><div className="list-row" key={item.id}>
       <div className="stack" style={{gap:5,minWidth:0,flex:1}}>
        <div className="flex center gap8 wrap"><strong>{item.title}</strong>
         <span className="pill muted">{item.channel}</span>
         <span className={"pill "+(item.status==="planned"?"warn":"")}>{statusNames[item.status]}</span>
        </div>
        <div className="caption"><Clock size={12} style={{display:"inline",marginRight:5}}/>{formatDate(item.planned_at)} · Fuso del dispositivo</div>
        {item.notes&&<p className="caption">{item.notes}</p>}
        {item.content_id&&<div className="caption">Contenuto associato: {data.contents.find(x=>x.id===item.content_id)?.title||"Non più disponibile"}</div>}
        {collides(item)&&<div className="caption" style={{color:"var(--danger)"}}>Possibile sovrapposizione: stesso canale a meno di 30 minuti</div>}
       </div>
       <div className="flex center gap8 wrap">
        {item.status==="ready"&&<button className="button small" disabled={Boolean(busy)} onClick={()=>onAction("calendarUpdate",{id:item.id,status:"completed"})}><CheckCircle2 size={14}/> Segna completato</button>}
        {item.status!=="ready"&&item.status!=="completed"&&item.status!=="cancelled"&&
         <button className="button small" disabled={Boolean(busy)} onClick={()=>onAction("calendarUpdate",{id:item.id,status:"ready"})}><CheckCircle2 size={14}/> Pronto</button>}
        <button className="button small ghost" aria-label={"Elimina "+item.title} disabled={Boolean(busy)} onClick={()=>{if(window.confirm("Eliminare questa uscita dal calendario?"))onAction("calendarDelete",{id:item.id})}}><Trash2 size={15}/></button>
       </div>
      </div>)}
    </div>}
  </div>;
}
