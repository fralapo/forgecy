import assert from "node:assert/strict";
import {test} from "node:test";
import {
  knowledgeQueryFromQuestion,
  contextFromKnowledgeHits,
  retrieveClientKnowledge,
  fuseKnowledgeHits
} from "../../lib/knowledge-search";

test("retrieval terms are bounded, unique and skip generic filler",()=>{
  assert.equal(knowledgeQueryFromQuestion("cosa sai del posizionamento e target del cliente?"),
    "posizionamento OR target");
  assert.equal(knowledgeQueryFromQuestion("  COME  COSA  QUANDO  "),null);
  assert.equal(knowledgeQueryFromQuestion("prodotti prodotti SERVIZI"),"prodotti OR servizi");
  assert.ok(knowledgeQueryFromQuestion("Termine ".repeat(100))!.length<=200);
});

test("search evidence context retains source IDs and avoids copying scores",()=>{
 const packet=contextFromKnowledgeHits([{
   source_id:"client-owned-source",source_title:"Brief aziendale",
   source_url:"https://example.com/brief",chunk_ordinal:2,
   excerpt:"L'azienda offre servizi per il retail.",relevance:0.5
 }]);
 assert.deepEqual(packet,[{
   source_id:"client-owned-source",
   title:"Brief aziendale",
   url:"https://example.com/brief",
   excerpt:"L'azienda offre servizi per il retail."
 }]);
 assert.equal("relevance" in packet[0],false);
});

test("hybrid fusion combines lexical and semantic ranks without comparing score scales",()=>{
 const hit=(source_id:string,chunk_ordinal:number,relevance:number)=>({source_id,source_title:source_id,source_url:null,chunk_ordinal,excerpt:source_id,relevance});
 const lexical=[hit("exact",0,0.9),hit("other",0,0.4)];
 const semantic=[hit("paraphrase",2,0.97),hit("exact",0,0.55)];
 const fused=fuseKnowledgeHits(lexical,semantic,3);
 assert.deepEqual(fused.map(value=>value.source_id),["exact","paraphrase","other"]);
});


test("worker retrieval uses the private owner-checked RPC instead of a session-only RPC",async()=>{
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const ctx={
  db:{rpc:async(name:string,args:Record<string,unknown>)=>{
   calls.push({name,args});return {data:[],error:null};
  },from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{semantic_enabled:0},error:null})})})})},
  user:{id:"11111111-1111-4111-8111-111111111111"},
  workerRequestedBy:"11111111-1111-4111-8111-111111111111"
 } as unknown as import("../../lib/http").Context;
 await retrieveClientKnowledge(ctx,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","focaccia prodotti",4);
 assert.deepEqual(calls,[{
  name:"forgecy_worker_search_client_sources",
  args:{p_client_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
   p_requested_by:"11111111-1111-4111-8111-111111111111",
   p_query:"focaccia OR prodotti",p_limit:12}
 }]);
});


test("ordinary authenticated retrieval keeps the session/RLS RPC",async()=>{
 let received:unknown;
 const ctx={db:{rpc:async(name:string,args:Record<string,unknown>)=>{
  received={name,args};return {data:[],error:null};
 },from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{semantic_enabled:0},error:null})})})})},user:{id:"11111111-1111-4111-8111-111111111111"}} as unknown as import("../../lib/http").Context;
 await retrieveClientKnowledge(ctx,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","focaccia",4);
 assert.deepEqual(received,{name:"forgecy_search_client_sources",args:{
  p_client_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",p_query:"focaccia",p_limit:12
 }});
});
