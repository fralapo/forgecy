"use client";
import {FormEvent,useEffect,useState} from "react";
import {BookOpen,ExternalLink,Search} from "lucide-react";
import {requestJson} from "./types";

type KnowledgeHit={
 source_id:string;source_title:string;source_url:string|null;
 chunk_ordinal:number;excerpt:string;relevance:number
};
type Results={query:string;hits:KnowledgeHit[];mode:"lexical";limit:number};

function publicLink(value:string|null) {
 if(!value)return null;
 try{
   const url=new URL(value);
   return url.protocol==="https:"||url.protocol==="http:"?url.toString():null;
 }catch{return null;}
}

export default function KnowledgeSearch({clientId,sourceCount}:{
  clientId:string;sourceCount:number
}){
 const [query,setQuery]=useState("");
 const [results,setResults]=useState<Results|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{
   setQuery("");setResults(null);setError("");setLoading(false);
 },[clientId]);

 async function search(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const value=query.trim();
  if(value.length<2||value.length>200)return;
  setLoading(true);setError("");setResults(null);
  try{
    const response=await requestJson<Results>(
      "/api/workspace/clients/"+encodeURIComponent(clientId)+
      "/knowledge/search?q="+encodeURIComponent(value)+"&limit=12"
    );
    setResults(response);
  }catch(e){
    setError(e instanceof Error?e.message:"Ricerca non disponibile");
  }finally{setLoading(false);}
 }

 return <section className="card stack" aria-label="Ricerca nelle fonti del cliente">
  <div className="flex center gap8"><BookOpen size={18}/><h2>Ricerca nella memoria aziendale</h2></div>
  <p className="tagline">Cerca nei testi del sito e nei documenti acquisiti. Ogni passaggio conserva il riferimento alla fonte originale.</p>
  <form onSubmit={search} className="flex center gap8 wrap" role="search">
   <label htmlFor="forgecy-knowledge-query" className="caption" style={{width:"100%"}}>Parole o argomenti da cercare</label>
   <input id="forgecy-knowledge-query" type="search"
     value={query} onChange={event=>setQuery(event.target.value)}
     disabled={!sourceCount||loading} required minLength={2} maxLength={200}
     placeholder="Es. posizionamento, servizi, target…"
     style={{flex:"1 1 220px",minWidth:0}}/>
   <button className="button primary" type="submit"
     disabled={!sourceCount||loading||query.trim().length<2}>
     <Search size={15}/>{loading?"Ricerca…":"Cerca"}
   </button>
  </form>
  {error&&<p role="alert" className="notice warn">{error}</p>}
  {results&&<div className="stack" aria-live="polite">
   <p className="caption">{results.hits.length} passaggi trovati per “{results.query}”. Ricerca testuale, non semantica.</p>
   {!results.hits.length&&<p className="tagline">Nessuna corrispondenza. Prova con termini diversi o verifica che il documento sia stato estratto correttamente.</p>}
   {results.hits.map(hit=><article className="finding" key={hit.source_id+":"+hit.chunk_ordinal}>
    <div className="flex between center wrap gap8">
      <strong>{hit.source_title}</strong>
      <span className="caption">Estratto {hit.chunk_ordinal+1}</span>
    </div>
    <p style={{whiteSpace:"pre-wrap",marginTop:9}}>{hit.excerpt.slice(0,680)}{hit.excerpt.length>680?"…":""}</p>
    <div className="flex center between wrap gap8" style={{marginTop:9}}>
      <span className="caption">Fonte {hit.source_id.slice(0,8)}</span>
      {publicLink(hit.source_url)&&<a className="caption"
        href={publicLink(hit.source_url)!} target="_blank" rel="noopener noreferrer">
        Apri fonte <ExternalLink size={12} style={{display:"inline"}}/>
      </a>}
    </div>
   </article>)}
  </div>}
 </section>;
}
