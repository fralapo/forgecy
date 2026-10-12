import type {Context} from "./http";

/** Convert conversational Italian/English into a bounded OR query for multilingual source retrieval. */
export function evidenceQuery(question:string):string{
 const stop=new Set(["questo","questa","quello","quella","quali","qualche","come",
  "sono","abbiamo","clienti","cliente","azienda","della","delle","degli","nelle",
  "fatto","dove","perché","cosa","vorrei","quanto","quanta","about","what","which",
  "tell","have","does","these","those","could","would","please","from","with",
  "and","their","them","into","the","that","your"]);
 const terms=question.toLocaleLowerCase("it").normalize("NFKC")
   .match(/[\p{L}\p{N}]{4,}/gu)||[];
 const unique=[...new Set(terms.filter(x=>!stop.has(x)))].slice(0,7);
 return unique.join(" OR ").slice(0,160);
}
export type RelevantEvidence={id:string;title:string;kind:string;url:string|null;excerpt:string;relevance:number};
export async function findRelevantEvidence(ctx:Context,clientId:string,question:string):Promise<RelevantEvidence[]>{
 const query=evidenceQuery(question);
 if(query.length<2)return [];
 const result=await ctx.db.rpc("forgecy_search_sources",{
   p_client_id:clientId,p_query:query,p_limit:7
 });
 if(result.error){
   console.error("[knowledge search]",result.error.message);
   return []; // search is an optional retrieval boost, never a fabricated result.
 }
 return (result.data||[]).map((s:{
   id:string;title:string;kind:string;url:string|null;excerpt:string;relevance:number
 })=>({
   id:s.id,title:String(s.title).slice(0,160),kind:s.kind,
   url:s.url||null,excerpt:String(s.excerpt).slice(0,1100),relevance:s.relevance
 }));
}
