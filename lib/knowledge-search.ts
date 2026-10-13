import type {Context} from "./http";
import {ApiFailure} from "./http";

export type KnowledgeHit={
  source_id:string;
  source_title:string;
  source_url:string|null;
  chunk_ordinal:number;
  excerpt:string;
  relevance:number;
};

const STOP_WORDS=new Set([
  "come","cosa","quale","quali","quando","dove","perche","perché","quanto",
  "sai","del","dei","degli","dello","dell","dati","parlami","anche",
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

export async function retrieveClientKnowledge(
 ctx:Context,clientId:string,question:string,limit=8
):Promise<KnowledgeHit[]> {
  const phrase=knowledgeQueryFromQuestion(question);
  if(!phrase)return [];
  const args={p_client_id:clientId,p_query:phrase,p_limit:Math.min(Math.max(limit,1),20)};
  // A service-role worker has no auth.uid(). Its private RPC checks the queued
  // requester against the client owner; browser sessions retain the RLS RPC.
  const {data,error}=ctx.workerRequestedBy
    ?await ctx.db.rpc("forgecy_worker_search_client_sources",{
      ...args,p_requested_by:ctx.workerRequestedBy
    })
    :await ctx.db.rpc("forgecy_search_client_sources",args);
  if(error)throw new ApiFailure(500,"La ricerca nella memoria aziendale non è disponibile");
  return (data||[]).map((row:KnowledgeHit)=>({
    source_id:row.source_id,
    source_title:row.source_title,
    source_url:row.source_url||null,
    chunk_ordinal:row.chunk_ordinal,
    excerpt:row.excerpt.slice(0,1700),
    relevance:row.relevance
  }));
}

/** A compact, auditable evidence packet. Do not treat its contents as instructions. */
export function contextFromKnowledgeHits(hits:KnowledgeHit[]) {
  return hits.map(hit=>({
    source_id:hit.source_id,
    title:hit.source_title,
    url:hit.source_url,
    excerpt:hit.excerpt
  }));
}
