import {test} from "node:test";
import {strict as assert} from "node:assert";
import {playbook,routedSkills,stageSkills} from "../../lib/skills/playbooks";
import {reviewStaticAssets,type StaticAsset} from "../../lib/skills/quality";
import {extractDocument,extractDocumentWithMetadata} from "../../lib/document-extract";
import {PDFDocument,StandardFonts} from "pdf-lib";
const proofId="11111111-1111-4111-8111-111111111111";
function asset(channel:"instagram"|"linkedin",format:"post"|"carousel"|"document"):StaticAsset{
 return {
  channel,format,title:"Guida ai tessuti delicati",caption:"Una spiegazione utile e verificabile.",
  slides:format==="post"?[]:[
   {headline:"Come iniziare",body:"Leggi l'etichetta"},{headline:"Cosa controllare",body:"Verifica il simbolo"},{headline:"Ricapitolando",body:"Rispetta le istruzioni"}
  ],
  editorial_brief:{audience_need:"Come prendersi cura dei capi",hook:"Leggi prima l'etichetta",
   promise:"Scegli in modo consapevole",value_delivered:"Indicazioni presenti nelle slide",rational_proof:"Etichetta di manutenzione",
   single_cta:"",community_signal_ids:[proofId]}
 };
}
test("stage skills match agency production without video",()=>{
 assert.ok(routedSkills("strategist").includes("marketing-mba"));
 assert.ok(routedSkills("quality").includes("creative-director"));
 for(const stage of Object.keys(stageSkills) as Array<keyof typeof stageSkills>)
  assert.ok(playbook(stage).length>120);
});
test("valid cross-channel content is structurally acceptable",()=>{
 assert.deepEqual(reviewStaticAssets([asset("instagram","carousel"),asset("linkedin","document")],new Set([proofId])),[]);
});
test("a campaign proposal must include both static channels",()=>{
 const issues=reviewStaticAssets([asset("instagram","post")],new Set([proofId]));
 assert.ok(issues.some(x=>x.code==="missing_linkedin"&&x.severity==="blocking"));
});
test("wrong format, unknown evidence and short carousel are blockers",()=>{
 const a=asset("instagram","document");a.slides.pop();a.editorial_brief.community_signal_ids=["99999999-9999-4999-8999-999999999999"];
 const issues=reviewStaticAssets([a,asset("linkedin","post")],new Set([proofId]));
 for(const code of ["invalid_format","slide_count","unknown_signal"])
  assert.ok(issues.some(x=>x.code===code&&x.severity==="blocking"),code);
});
test("plain-text uploads are available as evidence",async()=>{
 const result=await extractDocument(new TextEncoder().encode("Client facts\r\nConfirmed price 12 EUR"),"text/plain","brief.txt");
 assert.equal(result.status,"ready");
 assert.match(result.body,/Confirmed price/);
});
test("image extraction remains pending until the configured OCR API runs",async()=>{
 const result=await extractDocument(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),"image/png","label.png");
 assert.equal(result.status,"pending");assert.equal(result.body,"");
});
test("invalid PDF and DOCX cannot enter the approved source pool",async()=>{
 const pdf=await extractDocument(new Uint8Array([1,2,3]),"application/pdf","suspicious.pdf");
 const docx=await extractDocument(new Uint8Array([1,2,3]),"application/vnd.openxmlformats-officedocument.wordprocessingml.document","suspicious.docx");
 assert.equal(pdf.status,"error");assert.equal(docx.status,"error");
});
test("genuine text PDF is extracted without OCR",async()=>{
 const doc=await PDFDocument.create();
 const page=doc.addPage([450,500]),font=await doc.embedFont(StandardFonts.Helvetica);
 page.drawText("Verified product information from a customer brief.",{x:50,y:420,size:14,font});
 page.drawText("Product code SAMPLE-123; quantity 2; delivery in five business days.",{x:50,y:400,size:14,font});
 const result=await extractDocument(await doc.save(),"application/pdf","brief.pdf");
 assert.equal(result.status,"ready",result.error||"");
 assert.match(result.body,/Verified product information/);
});
test("page boundary markers alone do not make a multi-page scan look like extracted text",async()=>{
 const doc=await PDFDocument.create();doc.addPage([450,500]);doc.addPage([450,500]);
 const result=await extractDocument(await doc.save(),"application/pdf","scan.pdf");
 assert.equal(result.status,"error");
 assert.equal(result.error,"PDF senza testo nativo sufficiente: serve OCR o una trascrizione");
});
test("PDF with only a short header/footer does not suppress API OCR",async()=>{
 const doc=await PDFDocument.create();
 const page=doc.addPage([450,500]),font=await doc.embedFont(StandardFonts.Helvetica);
 page.drawText("linea cucina linea cucina linea cucina pagina 17",{x:50,y:420,size:12,font});
 const result=await extractDocumentWithMetadata(await doc.save(),"application/pdf","scanned-catalog-page.pdf");
 assert.equal(result.pageCount,1);
 assert.equal(result.extraction.status,"error");
 assert.equal(result.extraction.error,"PDF senza testo nativo sufficiente: serve OCR o una trascrizione");
});
test("PDF preflight returns its page count for reuse by API-only OCR",async()=>{
 const doc=await PDFDocument.create();doc.addPage([450,500]);doc.addPage([450,500]);
 const result=await extractDocumentWithMetadata(await doc.save(),"application/pdf","scan.pdf");
 assert.equal(result.pageCount,2);
 assert.equal(result.extraction.status,"error");
});
test("native PDF extraction reports when pages beyond the processing limit were not read",async()=>{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 for(let pageNumber=1;pageNumber<=42;pageNumber++){
  const page=doc.addPage([450,500]);
  page.drawText(pageNumber===42?"CONTENT AFTER THE EXTRACTION LIMIT":"Verified product information with enough native text for extraction.",{x:40,y:420,size:12,font});
 }
 const result=await extractDocumentWithMetadata(await doc.save(),"application/pdf","long-catalog.pdf");
 assert.equal(result.extraction.status,"ready");
 assert.equal(result.pageCount,42);
 assert.equal(result.pagesProcessed,40);
 assert.equal(result.textTruncated,true);
 assert.doesNotMatch(result.extraction.body,/CONTENT AFTER THE EXTRACTION LIMIT/);
});
test("text extraction reports when it reaches the stored evidence character limit",async()=>{
 const result=await extractDocumentWithMetadata(new TextEncoder().encode("a".repeat(80_001)),"text/plain","long-brief.txt");
 assert.equal(result.extraction.status,"ready");
 assert.equal(result.extraction.body.length,80_000);
 assert.equal(result.textTruncated,true);
});
