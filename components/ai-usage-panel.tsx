"use client";
import {useEffect,useState} from "react";
import {requestJson} from "./types";

type Group={
  provider:string;operation:string;model:string;calls:number;
  token_reported_calls:number;cost_reported_calls:number;
  prompt_tokens:number;completion_tokens:number;reported_cost_usd:number|null;
};
type Snapshot={
  days:number;groups:Group[];totals:{
    calls:number;token_reported_calls:number;cost_reported_calls:number;
    prompt_tokens:number;completion_tokens:number;
    reported_cost_usd:number|null;cost_partial:boolean;
  };
};
const euroUsd=(value:number|null)=>value===null?"—":
  new Intl.NumberFormat("it-IT",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:5}).format(value);
const count=(value:number)=>value.toLocaleString("it-IT");
export default function AiUsagePanel({clientId}:{clientId:string}){
 const [days,setDays]=useState(30);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
   let alive=true;
   setLoading(true);setError("");setSnapshot(null);
   requestJson<Snapshot>("/api/workspace/clients/"+clientId+"/ai-usage?days="+days)
     .then(data=>{if(alive)setSnapshot(data);})
     .catch(err=>{if(alive)setError(err instanceof Error?err.message:"Registro non disponibile");})
     .finally(()=>{if(alive)setLoading(false);});
   return()=>{alive=false};
 },[clientId,days]);
 const summary=snapshot?.totals;
 return <div className="card" style={{marginTop:20}}>
   <div className="section-title">
     <div><h2>Utilizzo dei modelli AI</h2>
       <p className="caption" style={{marginTop:5}}>Solo il cliente corrente · valori comunicati dai provider, non stime di fatturazione</p></div>
     <select aria-label="Periodo utilizzo AI" value={days} onChange={e=>setDays(Number(e.target.value))}
       style={{maxWidth:180}}>
       <option value={7}>Ultimi 7 giorni</option>
       <option value={30}>Ultimi 30 giorni</option>
       <option value={90}>Ultimi 90 giorni</option>
     </select>
   </div>
   {loading?<p className="caption">Caricamento consumo AI…</p>:
     error?<div className="notice warn">{error}</div>:
     summary&&<div className="stack" style={{gap:15}}>
       <div className="grid3">
         <div className="metric-card"><span className="muted">Chiamate registrate</span>
           <strong>{count(summary.calls)}</strong></div>
         <div className="metric-card"><span className="muted">Token rilevati</span>
           <strong>{count(summary.prompt_tokens+summary.completion_tokens)}</strong>
           <small>Input e output comunicati</small></div>
         <div className="metric-card"><span className="muted">Costo riportato in USD</span>
           <strong>{euroUsd(summary.reported_cost_usd)}</strong>
           <small>{summary.cost_reported_calls} / {summary.calls} chiamate con costo disponibile</small></div>
       </div>
       {summary.cost_partial&&<div className="notice warn">
         Il totale è parziale: alcune risposte non comunicano un costo. Il valore non costituisce un limite di spesa né una fattura.
       </div>}
       {!summary.calls&&<p className="caption">Nessuna rilevazione disponibile. Il registro richiede la migrazione 0017 e il servizio server-side configurato; eventuali chiamate precedenti non sono retroattive.</p>}
       {snapshot?.groups.length? <div>
         <h3 style={{fontSize:14,marginBottom:10}}>Dettaglio per provider e modello</h3>
         {snapshot.groups.map((group,index)=><div className="list-row" key={group.provider+group.model+group.operation+index}>
           <div className="stack" style={{gap:3,minWidth:0}}>
             <strong>{group.model}</strong>
             <small className="caption">{group.provider} · {group.operation} · {count(group.calls)} chiamate</small>
           </div>
           <div style={{textAlign:"right"}}>
             <strong>{euroUsd(group.reported_cost_usd)}</strong>
             <small className="caption" style={{display:"block"}}>{group.cost_reported_calls}/{group.calls} con costo</small>
           </div>
         </div>)}
       </div>:null}
       <p className="caption">Immagini OpenAI: token dove disponibili; costo USD non comunicato dall'endpoint immagini. Le richieste non ricevute o non registrate dal backend potrebbero mancare.</p>
     </div>}
 </div>;
}
