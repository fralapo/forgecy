import assert from "node:assert/strict";
import {test} from "node:test";
import {
  knowledgeQueryFromQuestion,
  knowledgeQueryContainsIdentifier,
  knowledgeQueryContainsNumericValue,
  rankKnowledgeHitsByExactNumbers,
  contextFromKnowledgeHits,
  retrieveClientKnowledge,
  fuseKnowledgeHits
} from "../../lib/knowledge-search";

test("retrieval terms are bounded, unique and skip generic filler",()=>{
  assert.equal(knowledgeQueryFromQuestion("cosa sai del posizionamento e target del cliente?"),
    "posizionamento OR target");
  assert.equal(knowledgeQueryFromQuestion("  COME  COSA  QUANDO  "),null);
  assert.equal(knowledgeQueryFromQuestion("prodotti prodotti SERVIZI"),"prodotti OR servizi");
  assert.equal(knowledgeQueryFromQuestion("Quanto costa la chiave USAG 282 TSN con nasello tondo per ghiere da 35 a 50 mm?"),
    "costa OR chiave OR usag OR 282 OR tsn OR nasello OR tondo OR ghiere OR 35 OR 50");
 assert.equal(knowledgeQueryFromQuestion("A quale segmento appartiene il prodotto Vaillant con codice 0010013146?"),
  "segmento OR appartiene OR prodotto OR vaillant OR codice OR 0010013146");
  assert.ok(knowledgeQueryFromQuestion("Termine ".repeat(100))!.length<=200);
 assert.equal(knowledgeQueryContainsIdentifier("Quanto costa il prodotto 0010013146?"),true);
 assert.equal(knowledgeQueryContainsIdentifier("Quanto costa la chiave U02831302?"),true);
 assert.equal(knowledgeQueryContainsIdentifier("Qual è il prezzo del codice 101.080.25.28?"),true);
 assert.equal(knowledgeQueryContainsIdentifier("Quanto costa la chiave poligonale?"),false);
 assert.equal(knowledgeQueryContainsNumericValue("Quanto costa la chiave da 35 a 50 mm?"),true);
 assert.equal(knowledgeQueryContainsNumericValue("Quanto costa la chiave poligonale?"),false);
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

test("hybrid fusion prioritizes exact product identifiers when the lexical match is strongest",()=>{
 const hit=(source_id:string,chunk_ordinal:number)=>({source_id,source_title:source_id,source_url:null,chunk_ordinal,excerpt:source_id,relevance:1});
 const lexical=[hit("exact-code",0),hit("similar-product",0)];
 const semantic=[hit("similar-product",0),hit("nearby-product",0),hit("exact-code",0)];
 assert.equal(fuseKnowledgeHits(lexical,semantic,3,1)[0].source_id,"similar-product");
 assert.equal(fuseKnowledgeHits(lexical,semantic,3,3)[0].source_id,"exact-code");
});

test("exact numeric measurements promote matching evidence and normalize Italian decimals",()=>{
 const hits=[
  {source_id:"near",excerpt:"OMNIA M 3.2 taglia 06 HI3, potenza 6,35 kW",relevance:1},
  {source_id:"exact",excerpt:"OMNIA M 3.2 taglia 08 HI3, potenza 8,40 kW",relevance:0.5},
  {source_id:"other",excerpt:"OMNIA LIFE M taglia 08, potenza 8,40 kW",relevance:0.8},
 ];
 assert.deepEqual(rankKnowledgeHitsByExactNumbers("OMNIA M 3.2 taglia 08 HI3 potenza 8,4 kW",hits)
  .map(hit=>hit.source_id),["exact","other","near"]);
 assert.equal(rankKnowledgeHitsByExactNumbers("nessuna misura qui",hits),hits);
});

test("local lexical fallback ranks matching numeric product variants first",async()=>{
 const candidates=[
  {source_id:"near",source_title:"Listino",source_url:"https://example.test/list.pdf",chunk_ordinal:0,
   excerpt:"OMNIA M 3.2 taglia 06 HI3, potenza termica 6,35 kW, prezzo 9.172,80 EUR.",relevance:0.9},
  {source_id:"exact",source_title:"Listino",source_url:"https://example.test/list.pdf",chunk_ordinal:0,
   excerpt:"OMNIA M 3.2 taglia 08 HI3, potenza termica 8,40 kW, prezzo 9.613,76 EUR.",relevance:0.5},
 ];
 const ctx={db:{rpc:async()=>({data:candidates,error:null}),from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{semantic_enabled:0},error:null})})})})},
  user:{id:"11111111-1111-4111-8111-111111111111"}} as unknown as import("../../lib/http").Context;
 const hits=await retrieveClientKnowledge(ctx,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "OMNIA M 3.2 taglia 08 HI3 potenza 8,4 kW",2);
 assert.equal(hits[0].source_id,"exact");
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
