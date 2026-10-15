import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";

type Candidate={id:string;passage:string;source_url:string|null};

test("retrieval evaluation catalog distractors are sourced, unique and distinct from query targets",()=>{
 const fixturePath=join(process.cwd(),"tests/fixtures/retrieval-eval-candidates.json");
 const queryPath=join(process.cwd(),"tests/fixtures/retrieval-eval.json");
 const candidates=JSON.parse(readFileSync(fixturePath,"utf8")) as Candidate[];
 const targets=JSON.parse(readFileSync(queryPath,"utf8")) as Array<{id:string;passage:string;category:string;source_url?:string}>;
 assert.equal(targets.length,45);
 assert.equal(candidates.length,160);
 const catalogTargets=targets.filter(target=>target.category.startsWith("catalog-"));
 assert.equal(catalogTargets.length,37);
 assert.ok(catalogTargets.every(target=>target.source_url),"every public catalog target must have a citation source");
 assert.equal(new Set(candidates.map(candidate=>candidate.id)).size,candidates.length);
 const targetIds=new Set(targets.map(target=>target.id));
 const targetProductCodes=new Set(targets.flatMap(target=>[...target.passage.matchAll(/(?:codice|articolo)\s+([A-Z0-9]+(?:[.-][A-Z0-9]+)*)/giu)].map(match=>match[1].toUpperCase())));
 const targetSicutoolVariants=new Set(targets.flatMap(target=>{
  const match=/codice (5234G \d+), larghezza (\d+) mm/u.exec(target.passage);
  return match?[`${match[1].replace(/\s+/gu,"")}:${match[2]}`]:[];
 }));
 const targetCaleffiVariants=new Set(targets.flatMap(target=>{
  const match=/codice (AIR\d{6})(?:, variante ([^,]+))?/u.exec(target.passage);
  return match?[`${match[1]}:${(match[2]||"default").normalize("NFKD").replace(/[\u0300-\u036f]/gu,"").toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]+/gu," ").trim()}`]:[];
 }));
 const targetConexCodes=new Set(targets.flatMap(target=>[...target.passage.matchAll(/codice ((?:8090\s+|8090R|8091\s+)[A-Z0-9]{9,12}),/giu)].map(match=>match[1]!.replace(/\s+/gu,"").toUpperCase())));
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
  const briani=/codice (\d{3}\.\d{3}\.\d{2}\.\d{2}), prezzo ([\d.]+,\d{2}) EUR\./u.exec(candidate.passage);
  const ferroli=/codice ([A-Z0-9]+), prezzo ([\d.]+,\d{2}) EUR\./u.exec(candidate.passage);
  const sicutool=/codice (5234G \d+), larghezza (\d+) mm, prezzo ([\d,]+) EUR\./u.exec(candidate.passage);
  const sicutoolCard=/codice ([A-Z0-9]+), (?:larghezza|lunghezza(?: totale)?) (\d+) mm,[^.]*?prezzo ([\d,]+) EUR(?:[.,;]|$)/u.exec(candidate.passage);
  const stanley=/codice ((?:FMHT|XTHT)[A-Z0-9-]+), lunghezza (\d+) m, larghezza (\d+) mm, prezzo ([\d,]+) EUR\./iu.exec(candidate.passage);
  const conex=/codice ((?:8090\s+|8090R|8091\s+)[A-Z0-9]{9,12}), misura ([^,]+), prezzo ([\d,]+) EUR al pezzo\./u.exec(candidate.passage);
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
  }else if(briani){
   assert.equal(candidate.source_url,"https://www.briani.it/FILE/429BRIANI_LISTINO_STAMPA_20260501.pdf");
   assert.equal(candidate.id,`briani-candidate-${briani[1]}`);
   assert.equal(targetProductCodes.has(briani[1]),false,candidate.id);
  }else if(ferroli){
   assert.equal(candidate.source_url,"https://cms.ferroli.com/sites/default/files/2026-09/LISTINO%20FERROLI%20MAR%202026_89LI3019_01_low.pdf");
   assert.match(candidate.id,/^ferroli-candidate-[a-z0-9-]+$/iu);
   assert.equal(targetProductCodes.has(ferroli[1]),false,candidate.id);
  }else if(stanley){
   assert.equal(candidate.source_url,"https://bynder.sbdinc.com/m/61870d470e95fbff/original/ST_Listino-2026-WEB-IT_DMK1.pdf");
   assert.equal(candidate.id,`stanley-candidate-${stanley[1].toLowerCase()}`);
   assert.equal(targetProductCodes.has(stanley[1].toUpperCase()),false,candidate.id);
  }else if(conex){
   const code=conex[1]!.replace(/\s+/gu,"");
   assert.equal(candidate.source_url,"https://conexbanninger.com/it/wp-content/uploads/sites/15/2024/12/LISTINO-2026_compressed-1.pdf");
   assert.equal(candidate.id,`conex-candidate-${code.toLowerCase()}`);
   assert.equal(targetConexCodes.has(code.toUpperCase()),false,candidate.id);
  }else if(sicutool){
   assert.equal(candidate.source_url,"https://www.sicutool.it/Novit%C3%A0/Catalogo-Sicutool-Utensili-2025");
   assert.equal(candidate.id,`sicutool-candidate-${sicutool[1].replace(/\s+/gu,"").toLowerCase()}-${sicutool[2]}`);
   assert.equal(targetSicutoolVariants.has(`${sicutool[1].replace(/\s+/gu,"")}:${sicutool[2]}`),false,candidate.id);
  }else if(sicutoolCard){
   assert.equal(candidate.source_url,"https://www.sicutool.it/Novit%C3%A0/Catalogo-Sicutool-Utensili-2025");
   assert.equal(candidate.id,`sicutool-card-candidate-${sicutoolCard[1].toLowerCase()}`);
   assert.equal(targetProductCodes.has(sicutoolCard[1].toUpperCase()),false,candidate.id);
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
 assert.deepEqual([...sources.values()].sort((a,b)=>a-b),[1,1,1,4,6,9,15,15,22,24,24,38]);
});
