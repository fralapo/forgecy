import type {ObservedSnapshot} from "./social-analytics";
export type DossierReport={
 version:number;summary:string;knowledge_revision:number;status:string;
 findings:Array<{topic:string;claim:string;certainty:string;source_ids:string[];evidence_quote?:string}>;
};
export type BlueprintReport={
 version:number;status:string;knowledge_revision:number;
 blueprint:{
  title:string;diagnosis:string;positioning:string;audiences:string[];
  objectives:Array<{goal:string;kpi:string;baseline:string|null;target:string;rationale:string}>;
  content_pillars:Array<{name:string;purpose:string;examples:string[]}>;
  channels:string[];roadmap:{days_30:string[];days_60:string[];days_90:string[]};
  risks:string[];unknowns:string[];evidence_source_ids:string[]
 }
};
export type Reference={id:string;title:string;kind?:string;url?:string|null};
export function md(value:unknown):string{
 const normalized=String(value??"").replace(/[\r\n\t]+/g," ")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
 const escaped=new Set(["\\","`","*","_","[","]"]);
 return [...normalized].map(char=>escaped.has(char)?"\\"+char:char).join("").trim();
}

export function renderDossierMarkdown(
 clientName:string,dossier:DossierReport,references:Reference[]
):string{
 const sources=new Map(references.map(r=>[r.id,r]));
 const parts=[
  "# Dossier aziendale — "+md(clientName),"",
  "Versione: "+dossier.version,
  "Revisione conoscenza: "+dossier.knowledge_revision,
  "Stato: "+md(dossier.status),"",
  "## Stato attuale","",md(dossier.summary),"",
  "## Evidenze, ipotesi e informazioni mancanti",""
 ];
 for(const finding of dossier.findings){
  parts.push("### "+md(finding.topic),"",
    "**"+md(finding.certainty.toUpperCase())+"** — "+md(finding.claim),"");
  if(finding.evidence_quote)parts.push("Estratto della fonte: “"+md(finding.evidence_quote)+"”","");
  parts.push("Fonti: "+(finding.source_ids.map(id=>{
    const known=sources.get(id);
    return known?md(known.title)+(known.url&&/^https?:\/\//i.test(known.url)?" ("+md(known.url)+")":""):"ID "+md(id);
  }).join("; ")||"Non indicate"),"");
 }
 parts.push("## Avvertenza","",
  "Le citazioni indicano che il testo è presente nella fonte; non certificano in modo indipendente la veridicità delle affermazioni.",
  "Le ipotesi richiedono verifica umana. Questo documento fotografa lo stato attuale e non è, da solo, un piano strategico.");
 return parts.join("\n").trim()+"\n";
}

export function renderStrategyMarkdown(clientName:string,strategy:BlueprintReport):string{
 const p=strategy.blueprint;
 const lines=[
  "# Piano strategico — "+md(clientName),"",
  "Versione: "+strategy.version,
  "Revisione conoscenza: "+strategy.knowledge_revision,
  "Stato: "+md(strategy.status),"",
  "## "+md(p.title),"",md(p.diagnosis),"",
  "## Posizionamento","",md(p.positioning),"",
  "## Pubblici prioritari","",...p.audiences.map(x=>"- "+md(x)),"",
  "## Obiettivi e KPI",""
 ];
 for(const obj of p.objectives){
  lines.push("### "+md(obj.goal),"","KPI: "+md(obj.kpi),
    "Baseline: "+md(obj.baseline||"Da misurare"),
    "Target proposto: "+md(obj.target),
    "Razionale: "+md(obj.rationale),"");
 }
 lines.push("## Pilastri editoriali","");
 for(const pillar of p.content_pillars){
  lines.push("### "+md(pillar.name),"",md(pillar.purpose),"",...pillar.examples.map(x=>"- "+md(x)),"");
 }
 lines.push("## Canali","",...p.channels.map(x=>"- "+md(x)),"",
  "## Roadmap 30 / 60 / 90 giorni","");
 for(const [period,steps] of [
   ["30 giorni",p.roadmap.days_30],["60 giorni",p.roadmap.days_60],["90 giorni",p.roadmap.days_90]
 ] as Array<[string,string[]]>){
  lines.push("### "+period,"",...steps.map(x=>"- "+md(x)),"");
 }
 lines.push("## Rischi","",...p.risks.map(x=>"- "+md(x)),"",
  "## Informazioni da approfondire","",...p.unknowns.map(x=>"- "+md(x)),"",
  "Fonti di supporto: "+p.evidence_source_ids.map(md).join(", "),"",
  "Nota: target e KPI prospettici non sono risultati misurati. Ogni aggiornamento deve essere rivalutato e approvato.");
 return lines.join("\n").trim()+"\n";
}

/** Spreadsheet-injection-safe, semicolon-separated UTF-8 CSV for Italian Excel defaults. */
export function excelCsvCell(value:unknown):string{
 if(value===null||value===undefined)return '""';
 let v=String(value).replace(/[\u0000-\u001f\u007f]/g," ").trim();
 if(/^[=+@-]/.test(v))v="'"+v;
 return '"'+v.replace(/"/g,'""')+'"';
}
export function instagramCsv(snapshot:ObservedSnapshot):string{
 if(snapshot.data.measured!==true)throw new Error("Si possono esportare soltanto rilevazioni reali");
 if(!snapshot.data.media?.length){
  const headers=["Tipo record","Username","Follower","Precisione follower","Post totali","Rilevato il","Fonte"];
  const row=["Profilo",snapshot.data.account?.username||"",snapshot.data.account?.followers_count??null,
   snapshot.data.metric_precision?.followers_count==="rounded"?"arrotondata":"esatta",
   snapshot.data.account?.media_count??null,snapshot.collected_at,snapshot.data.source||""];
  return "\ufeff"+[headers.map(excelCsvCell).join(";"),row.map(excelCsvCell).join(";")].join("\r\n")+"\r\n";
 }
 const headers=["ID post","Data post","Tipo","Caption","Permalink","Like","Commenti","Copertura","Salvataggi","Condivisioni","Acquisito il"];
 const rows=(snapshot.data.media||[]).map(p=>{
  const observed=(key:string)=>{
   const v=p.insights?.[key];
   return typeof v==="number"&&Number.isFinite(v)&&v>=0?v:null;
  };
  return [
   p.id,p.timestamp||"",p.media_type||"",p.caption||"",p.permalink||"",
   p.like_count??null,p.comments_count??null,observed("reach"),observed("saved"),
   observed("shares"),snapshot.collected_at
  ].map(excelCsvCell).join(";");
 });
 return "\ufeff"+[headers.map(excelCsvCell).join(";"),...rows].join("\r\n")+"\r\n";
}
