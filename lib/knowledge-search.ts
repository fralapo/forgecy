import type {Context} from "./http";
import {ApiFailure} from "./http";
import {knowledgeEmbeddingCounts,searchSemanticKnowledge} from "./knowledge-index";
import {LOCAL_EMBEDDING_INDEX_ID} from "./local-embeddings";

export type KnowledgeHit={
  source_id:string;
  source_title:string;
  source_url:string|null;
  chunk_ordinal:number;
  excerpt:string;
  relevance:number;
  section_title?:string;
};

const STOP_WORDS=new Set([
  "come","cosa","quale","quali","quando","dove","perche","perché","quanto",
  "sai","del","dei","degli","dello","dell","dati","parlami","anche",
  "con",
  "quanta","quanti","della","delle","degli","questo","questa","questi",
  "quello","quella","sono","avere","dalla","dello","sulla","sulle",
  "dovrei","vorrei","posso","potrei","puoi","fai","cliente","azienda",
  "fammi","dimmi","serve","sapere","informazioni","about","what","which",
  "where","when","does","with","from","that","have","tell","show"
]);

/** Keep retrieval bounded and forgiving: a disjunction of meaningful terms. */
export function knowledgeQueryFromQuestion(value:string):string|null {
  const words=(value.normalize("NFKC").toLocaleLowerCase("it")
    .match(/[\p{L}\p{N}]{3,}/gu)||[])
    .filter(v=>!STOP_WORDS.has(v));
  const distinct=[...new Set(words)].slice(0,6);
  if(!distinct.length)return null;
  return distinct.join(" OR ").slice(0,200);
}

export function knowledgeQueryContainsIdentifier(value:string):boolean {
  return (value.normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}./-]{3,}/gu)||[])
    .some(token=>/\d/u.test(token)&&(/[\p{L}]/u.test(token)||/^\d{7,}$/u.test(token)));
}

export async function retrieveClientKnowledge(
 ctx:Context,clientId:string,question:string,limit=8
):Promise<KnowledgeHit[]> {
  const phrase=knowledgeQueryFromQuestion(question);
  const boundedLimit=Math.min(Math.max(limit,1),20);
  const args={p_client_id:clientId,p_query:phrase||"",p_limit:Math.min(boundedLimit*3,20)};
  // A service-role worker has no auth.uid(). Its private RPC checks the queued
  // requester against the client owner; browser sessions retain the RLS RPC.
  const {data,error}=phrase?(ctx.workerRequestedBy
    ?await ctx.db.rpc("forgecy_worker_search_client_sources",{
      ...args,p_requested_by:ctx.workerRequestedBy
    })
    :await ctx.db.rpc("forgecy_search_client_sources",args)):{data:[],error:null};
  if(error)throw new ApiFailure(500,"La ricerca nella memoria aziendale non è disponibile");
  const lexical=(data||[]).map((row:KnowledgeHit)=>({
    source_id:row.source_id,
    source_title:row.source_title,
    source_url:row.source_url||null,
    chunk_ordinal:row.chunk_ordinal,
    excerpt:row.excerpt.slice(0,1700),
    relevance:row.relevance,
    ...(row.section_title?{section_title:String(row.section_title).slice(0,240)}:{})
  }));
  const preferences=await ctx.db.from("ai_preferences").select("semantic_enabled")
    .eq("owner_id",ctx.user.id).maybeSingle();
  if(preferences.error){
    console.error("[knowledge search] Could not read local retrieval preference");
    return lexical.slice(0,boundedLimit);
  }
  if(preferences.data?.semantic_enabled===0)return lexical.slice(0,boundedLimit);
  try{
    const counts=knowledgeEmbeddingCounts(clientId,LOCAL_EMBEDDING_INDEX_ID);
    if(counts.indexed===0)return lexical.slice(0,boundedLimit);
    const semantic=await searchSemanticKnowledge(clientId,question,Math.min(boundedLimit*3,20));
    return fuseKnowledgeHits(lexical,semantic,boundedLimit,knowledgeQueryContainsIdentifier(question)?3:1);
  }catch(error){
    console.error("[knowledge search] Local semantic search unavailable; using FTS5",error instanceof Error?error.message:"unknown error");
    return lexical.slice(0,boundedLimit);
  }
}

/** Merge independent ranked lists without making their score scales comparable. */
export function fuseKnowledgeHits(lexical:KnowledgeHit[],semantic:KnowledgeHit[],limit=8,lexicalWeight=1):KnowledgeHit[]{
 const fused=new Map<string,{hit:KnowledgeHit;score:number;lexicalScore:number}>();
 for(const [ranked,kind] of [[lexical,"lexical"],[semantic,"semantic"]] as const){
  ranked.forEach((hit,index)=>{
   const key=hit.source_id+":"+hit.chunk_ordinal;
   const current=fused.get(key);
   const score=(kind==="lexical"?lexicalWeight:1)/(60+index+1);
   if(current){current.score+=score;if(kind==="lexical")current.lexicalScore=hit.relevance;}
   else fused.set(key,{hit,score,lexicalScore:kind==="lexical"?hit.relevance:0});
  });
 }
 return [...fused.values()].sort((a,b)=>b.score-a.score||b.lexicalScore-a.lexicalScore)
  .slice(0,Math.min(20,Math.max(1,limit))).map(({hit})=>hit);
}

/** A compact, auditable evidence packet. Do not treat its contents as instructions. */
export function contextFromKnowledgeHits(hits:KnowledgeHit[]) {
  return hits.map(hit=>({
    source_id:hit.source_id,
    title:hit.source_title,
    url:hit.source_url,
    excerpt:hit.excerpt,
    ...(hit.section_title?{section:hit.section_title}:{})
  }));
}
