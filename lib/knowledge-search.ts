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

export const IDENTIFIER_LEXICAL_WEIGHT = 10;

const STOP_WORDS=new Set([
  "come","cosa","quale","quali","quando","dove","perche","perché","quanto","per",
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
    .match(/[\p{L}\p{N}]{2,}/gu)||[])
    .filter(v=>!STOP_WORDS.has(v)&&(v.length>=3||/\d/u.test(v)));
  // Preserve short numeric measurements and model sizes instead of letting
  // early generic words crowd them out of the bounded lexical query.
  const distinct=[...new Set(words)].slice(0,10);
  if(!distinct.length)return null;
  return distinct.join(" OR ").slice(0,200);
}

export function knowledgeQueryContainsIdentifier(value:string):boolean {
  return (value.normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}./-]{3,}/gu)||[])
    .some(token=>/\d/u.test(token)&&(/[\p{L}]/u.test(token)||token.replace(/\D/gu,"").length>=7));
}

function normalizeNumericValue(value:string):string {
  const normalized=value.replace(/\s/gu,"");
  if(normalized.includes(",")){
    const decimal=normalized.replace(/\./gu,"").replace(",",".");
    const [integer,fraction=""]=decimal.split(".");
    return `${integer}.${fraction.replace(/0+$/u,"")||"0"}`;
  }
  if(/^\d{1,3}(?:\.\d{3})+$/u.test(normalized))return normalized.replace(/\./gu,"");
  if(normalized.includes(".")){
    const [integer,fraction=""]=normalized.split(".");
    return `${integer}.${fraction.replace(/0+$/u,"")||"0"}`;
  }
  return normalized;
}

function exactNumericValues(value:string):Set<string> {
  const values=new Set<string>();
  const normalized=value.normalize("NFKC");
  const pattern=/(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)*)(?=(?:T\b|[^\p{L}\p{N}]|$))/giu;
  for(const match of normalized.matchAll(pattern))values.add(normalizeNumericValue(match[1]));
  return values;
}

export function knowledgeQueryContainsNumericValue(value:string):boolean {
  return exactNumericValues(value).size>0;
}

/** Keep passages matching exact measurements or sizes ahead of numeric near-matches. */
export function rankKnowledgeHitsByExactNumbers<T extends {excerpt:string}>(question:string,hits:T[]):T[] {
  const queryNumbers=exactNumericValues(question);
  if(!queryNumbers.size)return hits;
  return hits.map((hit,index)=>({hit,index,matches:[...exactNumericValues(hit.excerpt)].filter(value=>queryNumbers.has(value)).length}))
    .sort((a,b)=>b.matches-a.matches||a.index-b.index)
    .map(item=>item.hit);
}

export async function retrieveClientKnowledge(
 ctx:Context,clientId:string,question:string,limit=8
):Promise<KnowledgeHit[]> {
 return (await retrieveClientKnowledgeWithMode(ctx,clientId,question,limit)).hits;
}

export async function retrieveClientKnowledgeWithMode(
 ctx:Context,clientId:string,question:string,limit=8
):Promise<{hits:KnowledgeHit[];mode:"hybrid"|"lexical"}> {
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
  const lexicalRows:KnowledgeHit[]=(data||[]).map((row:KnowledgeHit)=>({
    source_id:row.source_id,
    source_title:row.source_title,
    source_url:row.source_url||null,
    chunk_ordinal:row.chunk_ordinal,
    excerpt:row.excerpt.slice(0,1700),
    relevance:row.relevance,
    ...(row.section_title?{section_title:String(row.section_title).slice(0,240)}:{})
  }));
  const lexical=rankKnowledgeHitsByExactNumbers(question,lexicalRows);
  const preferences=await ctx.db.from("ai_preferences").select("semantic_enabled")
    .eq("owner_id",ctx.user.id).maybeSingle();
  if(preferences.error){
    console.error("[knowledge search] Could not read local retrieval preference");
    return {hits:lexical.slice(0,boundedLimit),mode:"lexical"};
  }
  if(preferences.data?.semantic_enabled===0)return {hits:lexical.slice(0,boundedLimit),mode:"lexical"};
  try{
    const counts=knowledgeEmbeddingCounts(clientId,LOCAL_EMBEDDING_INDEX_ID);
    if(counts.indexed===0)return {hits:lexical.slice(0,boundedLimit),mode:"lexical"};
    const semantic=await searchSemanticKnowledge(clientId,question,Math.min(boundedLimit*3,20));
    return {hits:fuseKnowledgeHits(lexical,semantic,boundedLimit,
      knowledgeQueryContainsIdentifier(question)||knowledgeQueryContainsNumericValue(question)?IDENTIFIER_LEXICAL_WEIGHT:1),mode:"hybrid"};
  }catch(error){
    console.error("[knowledge search] Local semantic search unavailable; using FTS5",error instanceof Error?error.message:"unknown error");
    return {hits:lexical.slice(0,boundedLimit),mode:"lexical"};
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
