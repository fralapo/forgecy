import assert from "node:assert/strict";
import {test} from "node:test";
import {blueprintSchema,unknownEvidenceIds} from "../../lib/strategic-blueprint";

const valid={
 title:"Piano di comunicazione Atelier Forma",
 diagnosis:"L'azienda descrive il proprio lavoro attraverso servizi verificati e dati da monitorare.",
 positioning:"Studio di interior design orientato alla consulenza e alla progettazione.",
 audiences:["Proprietari interessati alla ristrutturazione"],
 objectives:[{goal:"Migliorare richieste di contatto qualificate",kpi:"Richieste da sito",
  baseline:null,target:"Definire il target dopo la prima misurazione",rationale:"Manca un dato storico"}],
 content_pillars:[{name:"Progettazione",purpose:"Spiegare come funziona il servizio",
  examples:["Dalla richiesta al progetto"]},{name:"Materiali",purpose:"Fornire consigli contestuali",
  examples:["Materiali in funzione degli spazi"]}],
 channels:["instagram","website"],roadmap:{days_30:["Audit"],days_60:["Test"],days_90:["Valutazione"]},
 risks:["Campione dati limitato"],unknowns:["Costo medio acquisizione"],evidence_source_ids:[]
};

test("central company strategy has explicit goals, KPI, roadmap and non-fabricated baseline",()=>{
 const x=blueprintSchema.parse(valid);
 assert.equal(x.objectives[0].baseline,null);
 assert.equal(x.roadmap.days_90[0],"Valutazione");
});
test("invalid strategy is rejected rather than silently accepted",()=>{
 assert.equal(blueprintSchema.safeParse({...valid,objectives:[]}).success,false);
 assert.equal(blueprintSchema.safeParse({...valid,channels:["myspace"]}).success,false);
});

test("strategy evidence validation rejects fabricated IDs but allows an empty evidence list",()=>{
 assert.deepEqual(unknownEvidenceIds(["source-a","made-up","made-up"],["source-a"]),["made-up"]);
 assert.deepEqual(unknownEvidenceIds([], ["source-a"]),[]);
});
