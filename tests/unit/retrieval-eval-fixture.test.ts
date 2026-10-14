import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";

type Candidate={id:string;passage:string;source_url:string|null};

test("retrieval evaluation catalog distractors are sourced, unique and distinct from query targets",()=>{
 const fixturePath=join(process.cwd(),"tests/fixtures/retrieval-eval-candidates.json");
 const queryPath=join(process.cwd(),"tests/fixtures/retrieval-eval.json");
 const candidates=JSON.parse(readFileSync(fixturePath,"utf8")) as Candidate[];
 const targets=JSON.parse(readFileSync(queryPath,"utf8")) as Array<{id:string;passage:string}>;
 assert.equal(candidates.length,66);
 assert.equal(new Set(candidates.map(candidate=>candidate.id)).size,candidates.length);
 const targetIds=new Set(targets.map(target=>target.id));
 const targetProductCodes=new Set(targets.flatMap(target=>[...target.passage.matchAll(/codice\s+([A-Z0-9-]+)/giu)].map(match=>match[1].toUpperCase())));
 const distractorIds=new Set(candidates.map(candidate=>candidate.id));
 assert.equal([...targetIds].some(id=>distractorIds.has(id)),false);
 const sources=new Map<string,number>();
 for(const candidate of candidates){
  assert.ok(candidate.source_url,candidate.id);
  sources.set(candidate.source_url,(sources.get(candidate.source_url)??0)+1);
  const usag=/codice (U\d{8}), prezzo (\d{1,3}(?:\.\d{3})*,\d{2}) EUR\./u.exec(candidate.passage);
  const bosch=/codice (\d{10}), prezzo di listino IVA esclusa ([\d.]+,\d{2}) euro\./u.exec(candidate.passage);
  if(usag){
   assert.equal(candidate.source_url,"https://usag.it/usag_documents/documentisito/CataListino_ITA_2026.pdf");
   assert.equal(candidate.id,`usag-candidate-${usag[1].toLowerCase()}`);
   assert.equal(targetProductCodes.has(usag[1].toUpperCase()),false,candidate.id);
  }else{
   assert.ok(bosch,candidate.id);
   assert.equal(candidate.source_url,"https://www.bosch-industrial.com/it/media/country_pool/documenti/listino_2025_large_commercial_8738400436.pdf");
   assert.equal(candidate.id,`bosch-candidate-${bosch[1]}`);
   assert.equal(targetProductCodes.has(bosch[1]),false,candidate.id);
  }
 }
 assert.deepEqual([...sources.values()].sort((a,b)=>a-b),[24,42]);
});
