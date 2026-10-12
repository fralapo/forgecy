import assert from "node:assert/strict";
import {test} from "node:test";
import {renderDossierMarkdown,renderStrategyMarkdown,instagramCsv,excelCsvCell} from "../../lib/agency-reports";

test("dossier report prints traceable source titles and distinguishes inference",()=>{
 const md=renderDossierMarkdown("Atelier <img src=x onerror=alert(1)>",{
  version:2,knowledge_revision:5,status:"approved",summary:"Offerta descritta sul sito.",
  findings:[{topic:"Servizi",claim:"Consulenze di architettura",certainty:"verified",
   source_ids:["known-id"],evidence_quote:"Offriamo consulenze"}]
 },[{id:"known-id",title:"Chi siamo",url:"https://example.com/about"}]);
 assert.ok(md.includes("Chi siamo"));
 assert.ok(md.includes("https://example.com/about"));
 assert.ok(md.includes("VERIFIED"));
 assert.ok(md.includes("&lt;img"));
 assert.ok(!md.includes("<img"));
 assert.ok(md.includes("non certificano"));
});

test("strategy report exports KPI baseline gaps and all roadmap horizons",()=>{
 const doc=renderStrategyMarkdown("Cliente",{
  version:1,knowledge_revision:3,status:"draft",
  blueprint:{title:"Piano di comunicazione",diagnosis:"Diagnosi osservabile",positioning:"Posizionamento",
   audiences:["Piccole imprese"],objectives:[{goal:"Visibilità",kpi:"Copertura",
    baseline:null,target:"Da concordare",rationale:"Valutazione"}],
   content_pillars:[{name:"Educazione",purpose:"Rispondere alle domande",examples:["Guida"]}],
   channels:["instagram"],roadmap:{days_30:["Audit"],days_60:["Test"],days_90:["Revisione"]},
   risks:[],unknowns:["Budget"],evidence_source_ids:[]}
 });
 assert.ok(doc.includes("Baseline: Da misurare"));
 assert.ok(doc.includes("30 giorni")&&doc.includes("90 giorni"));
 assert.ok(doc.includes("Budget"));
});
test("Instagram CSV uses only real data and avoids spreadsheet formulas",()=>{
 const csv=instagramCsv({id:"a",collected_at:"2026-10-12T00:00:00Z",period:"latest",
  data:{measured:true,media:[{id:"media",caption:'=HYPERLINK("https://example.com")',
   like_count:4,comments_count:0,insights:{saved:2}}]}});
 assert.ok(csv.includes("'=HYPERLINK"));
 assert.ok(csv.includes(';"4";"0";"";"2";'));
 assert.equal(excelCsvCell(null),'""');
 assert.throws(()=>instagramCsv({id:"b",collected_at:"2026-10-12",period:"demo",
  data:{measured:false,media:[]}}),/rilevazioni reali/);
});
