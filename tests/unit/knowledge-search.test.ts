import assert from "node:assert/strict";
import {test} from "node:test";
import {
  knowledgeQueryFromQuestion,
  contextFromKnowledgeHits
} from "../../lib/knowledge-search";

test("retrieval terms are bounded, unique and skip generic filler",()=>{
  assert.equal(knowledgeQueryFromQuestion("cosa sai del posizionamento e target del cliente?"),
    "sai OR del OR posizionamento OR target");
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
