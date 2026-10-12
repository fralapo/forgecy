import assert from "node:assert/strict";
import {test} from "node:test";
import {dedupeKnowledgeExcerpts,COMPANY_INTELLIGENCE_TOPICS} from "../../lib/dossier-retrieval";
import type {KnowledgeHit} from "../../lib/knowledge-search";

const hit=(id:string,ord:number):KnowledgeHit=>({
 source_id:id,source_title:"Fonte "+id,source_url:null,
 chunk_ordinal:ord,excerpt:"Extracted evidence "+id,relevance:0.4
});

test("dossier research covers distinct dimensions rather than ranking only one document",()=>{
 const result=dedupeKnowledgeExcerpts([
  [hit("a",0),hit("a",1),hit("a",2)],
  [hit("a",0),hit("b",0)],
  [hit("c",0)],
  [hit("d",0)]
 ]);
 assert.deepEqual(result.map(x=>x.source_id+":"+x.chunk_ordinal),
   ["a:0","c:0","d:0","a:1","b:0","a:2"]);
 assert.equal(COMPANY_INTELLIGENCE_TOPICS.length,4);
});

test("evidence selection is bounded, deduplicated and stable",()=>{
 const result=dedupeKnowledgeExcerpts([
  [hit("a",0),hit("a",1),hit("a",2)],
  [hit("b",0),hit("a",0),hit("b",1)]
 ],3);
 assert.deepEqual(result.map(x=>x.source_id+":"+x.chunk_ordinal),
   ["a:0","b:0","a:1"]);
});
