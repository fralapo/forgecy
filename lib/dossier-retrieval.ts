import type {Context} from "./http";
import {retrieveClientKnowledge,type KnowledgeHit} from "./knowledge-search";

/**
 * Product domains are different. Instead of taking only the first uploaded
 * documents, query several neutral dimensions and merge evidence fairly.
 * Four queries × four results = at most sixteen excerpts, all client-scoped.
 */
export const COMPANY_INTELLIGENCE_TOPICS=[
  "storia missione attività chi siamo",
  "servizi prodotti offerte vantaggi",
  "pubblico clienti target settore",
  "identità brand valori differenze posizionamento"
] as const;

export function dedupeKnowledgeExcerpts(
 groups:KnowledgeHit[][],maximum=16
):KnowledgeHit[]{
 const seen=new Set<string>();
 const result:KnowledgeHit[]=[];
 // Round-robin preserves topic coverage when one source dominates rank.
 let i=0;
 while(result.length<maximum && groups.some(g=>i<g.length)){
   for(const group of groups){
     const hit=group[i];
     if(!hit)continue;
     const key=hit.source_id+":"+hit.chunk_ordinal;
     if(!seen.has(key)){
       seen.add(key);
       result.push(hit);
       if(result.length===maximum)break;
     }
   }
   i++;
 }
 return result;
}

export async function dossierKnowledgeExcerpts(
 ctx:Context,clientId:string
):Promise<KnowledgeHit[]>{
 const groups=await Promise.all(
   COMPANY_INTELLIGENCE_TOPICS.map(topic=>
     retrieveClientKnowledge(ctx,clientId,topic,4)
   )
 );
 return dedupeKnowledgeExcerpts(groups);
}
