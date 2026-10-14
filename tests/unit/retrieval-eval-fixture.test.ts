import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";

type Candidate={id:string;passage:string;source_url:string|null};

test("retrieval evaluation catalog distractors are sourced, unique and distinct from query targets",()=>{
 const fixturePath=join(process.cwd(),"tests/fixtures/retrieval-eval-candidates.json");
 const queryPath=join(process.cwd(),"tests/fixtures/retrieval-eval.json");
 const candidates=JSON.parse(readFileSync(fixturePath,"utf8")) as Candidate[];
 const targets=JSON.parse(readFileSync(queryPath,"utf8")) as Array<{id:string}>;
 assert.equal(candidates.length,42);
 assert.equal(new Set(candidates.map(candidate=>candidate.id)).size,candidates.length);
 const targetIds=new Set(targets.map(target=>target.id));
 const distractorIds=new Set(candidates.map(candidate=>candidate.id));
 assert.equal([...targetIds].some(id=>distractorIds.has(id)),false);
 for(const candidate of candidates){
  assert.equal(candidate.source_url,"https://usag.it/usag_documents/documentisito/CataListino_ITA_2026.pdf");
  const row=/codice (U\d{8}), prezzo (\d{1,3}(?:\.\d{3})*,\d{2}) EUR\./u.exec(candidate.passage);
  assert.ok(row,candidate.id);
  assert.equal(candidate.id,`usag-candidate-${row[1].toLowerCase()}`);
 }
});
