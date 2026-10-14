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
 assert.equal(targets.length,28);
 assert.equal(candidates.length,111);
 assert.equal(new Set(candidates.map(candidate=>candidate.id)).size,candidates.length);
 const targetIds=new Set(targets.map(target=>target.id));
 const targetProductCodes=new Set(targets.flatMap(target=>[...target.passage.matchAll(/(?:codice|articolo)\s+([A-Z0-9-]+)/giu)].map(match=>match[1].toUpperCase())));
 const targetCaleffiVariants=new Set(targets.flatMap(target=>{
  const match=/codice (AIR\d{6})(?:, variante ([^,]+))?/u.exec(target.passage);
  return match?[`${match[1]}:${(match[2]||"default").normalize("NFKD").replace(/[\u0300-\u036f]/gu,"").toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]+/gu," ").trim()}`]:[];
 }));
 const distractorIds=new Set(candidates.map(candidate=>candidate.id));
 assert.equal([...targetIds].some(id=>distractorIds.has(id)),false);
 const sources=new Map<string,number>();
 for(const candidate of candidates){
  assert.ok(candidate.source_url,candidate.id);
  sources.set(candidate.source_url,(sources.get(candidate.source_url)??0)+1);
  const usag=/codice (U\d{8}), prezzo (\d{1,3}(?:\.\d{3})*,\d{2}) EUR\./u.exec(candidate.passage);
  const bosch=/codice (\d{10}), prezzo di listino IVA esclusa ([\d.]+,\d{2}) euro\./u.exec(candidate.passage);
  const vaillant=/codice (\d{10}), prezzo ([\d.]+,\d{2}) EUR\./u.exec(candidate.passage);
  const caleffi=/codice (AIR\d{6}(?: BLK)?), variante ([^,]+), .+?, prezzo ([\d.]+,\d{2}) EUR\./u.exec(candidate.passage);
  const upower=/articolo ([A-Z0-9]+); classe di protezione ([A-Z0-9 ]+)\./u.exec(candidate.passage);
  if(usag){
   assert.equal(candidate.source_url,"https://usag.it/usag_documents/documentisito/CataListino_ITA_2026.pdf");
   assert.equal(candidate.id,`usag-candidate-${usag[1].toLowerCase()}`);
   assert.equal(targetProductCodes.has(usag[1].toUpperCase()),false,candidate.id);
  }else if(bosch){
   assert.equal(candidate.source_url,"https://www.bosch-industrial.com/it/media/country_pool/documenti/listino_2025_large_commercial_8738400436.pdf");
   assert.equal(candidate.id,`bosch-candidate-${bosch[1]}`);
   assert.equal(targetProductCodes.has(bosch[1]),false,candidate.id);
  }else if(vaillant){
   assert.equal(candidate.source_url,"https://supporto.vaillant.it/downloads/vgoa-vaillant-it-doc/listini/2026/listino-vaillant-giugno-2026-3139348.pdf");
   assert.equal(candidate.id,`vaillant-candidate-${vaillant[1]}`);
   assert.equal(targetProductCodes.has(vaillant[1]),false,candidate.id);
  }else if(caleffi){
   assert.equal(candidate.source_url,"https://www.caleffi.com/sites/default/files/media/external-file/05070_IT_26_Listino%20prezzi%20VMC.pdf");
   assert.match(candidate.id,/^caleffi-candidate-[A-Z0-9-]+$/iu);
   const variantKey=`${caleffi[1]}:${caleffi[2].normalize("NFKD").replace(/[\u0300-\u036f]/gu,"").toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]+/gu," ").trim()}`;
   assert.equal(targetCaleffiVariants.has(variantKey),false,candidate.id);
  }else{
   assert.ok(upower,candidate.id);
   const productCode=/articolo ([A-Z0-9]+)/u.exec(candidate.passage)?.[1];
   assert.ok(productCode,candidate.id);
   const expectedSource=productCode==="0RP20176"?"https://u-power.ai/it-it/workwear/calzature/skat-plus-76"
    :productCode==="0RR20196"?"https://u-power.ai/it-it/workwear/calzature/brezza-96"
    :"https://www.u-power.it/it/calzature/monaco";
   assert.equal(candidate.source_url,expectedSource);
   assert.equal(candidate.id,`upower-candidate-${productCode}`);
   assert.equal(targetProductCodes.has(productCode.toUpperCase()),false,candidate.id);
  }
 }
 assert.deepEqual([...sources.values()].sort((a,b)=>a-b),[1,1,1,22,24,24,38]);
});
