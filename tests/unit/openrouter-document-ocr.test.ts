import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { ocrDocumentWithOpenRouter, parsedDocumentImages, parsedDocumentText } from "../../lib/openrouter-document-ocr";

test("prefers exact parsed PDF text annotations over the model's summary", () => {
  const text = parsedDocumentText({
    choices: [{message: {content: "Sintesi", annotations: [{type: "file", file: {content: [
      {type: "text", text: "Crema viso 50 ml — € 19,90"},
      {type: "image_url", image_url: {url: "data:image/png;base64,AA=="}}
    ]}}]}}]
  });
  assert.equal(text, "Crema viso 50 ml — € 19,90");
});

test("uses parsed file annotations from provider errors for safe OCR retries", () => {
  assert.equal(parsedDocumentText({error:{metadata:{file_annotations:[{type:"file",file:{content:[{type:"text",text:"Contenuto OCR conservato"}]}}]}}}),"Contenuto OCR conservato");
});

test("extracts only unique, supported and bounded PDF images from parser annotations",()=>{
  const image=Buffer.from([137,80,78,71,13,10,26,10]).toString("base64");
  const parsed=parsedDocumentImages({choices:[{message:{annotations:[{type:"file",file:{content:[
    {type:"image_url",image_url:{url:`data:image/png;base64,${image}`}},
    {type:"image_url",image_url:{url:`data:image/png;base64,${image}`}},
    {type:"image_url",image_url:{url:"data:image/gif;base64,R0lGODlh"}}
  ]}}]}}]});
  assert.equal(parsed.length,1);
  assert.equal(parsed[0]?.mime,"image/png");
  assert.equal(parsed[0]?.sha256.length,64);
});

test("sends validated images to the chosen vision model and returns its transcription", async () => {
  const png = new Uint8Array([137,80,78,71,13,10,26,10]);
  const captured: {request?: Record<string, unknown>} = {};
  const result = await ocrDocumentWithOpenRouter({
    bytes: png, mime: "image/png", name: "pagina.png", model: "deepseek/deepseek-v4.1-flash",
    keyProvider: async () => "test-key",
    fetcher: async (_input, init) => {
      captured.request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "gen-test", model: "deepseek/deepseek-v4.1-flash", usage: {prompt_tokens: 20, completion_tokens: 10},
        choices: [{message: {content: "Catalogo prodotti\nCrema viso 50 ml — € 19,90"}}]
      }), {status: 200});
    }
  });
  assert.equal(result.engine, "vision-model");
  assert.equal(result.pageCount, null);
  assert.match(result.body, /Crema viso 50 ml/);
  const request = captured.request!;
  const messages = request.messages as Array<{content:Array<Record<string, unknown>>}>;
  assert.equal(request.model, "deepseek/deepseek-v4.1-flash");
  assert.equal(messages[0]?.content[1]?.type, "image_url");
  assert.equal(request.plugins, undefined);
});

test("sends scanned PDFs through the bounded Mistral OCR parser and keeps its source text", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  const bytes = new Uint8Array(await pdf.save());
  let body: Record<string, unknown> | undefined;
  const result = await ocrDocumentWithOpenRouter({
    bytes, mime: "application/pdf", name: "catalogo.pdf", model: "deepseek/deepseek-v4.1-flash",
    keyProvider: async () => "test-key",
    fetcher: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "gen-pdf", model: "deepseek/deepseek-v4.1-flash", usage: {prompt_tokens: 20, completion_tokens: 10},
        choices: [{message: {content: "Ho letto il catalogo", annotations: [{type: "file", file: {content: [
          {type: "text", text: "Catalogo prodotti\nCrema viso 50 ml — € 19,90"}
        ]}}]}}]
      }), {status: 200});
    }
  });
  assert.equal(result.engine, "mistral-ocr");
  assert.equal(result.pageCount, 1);
  assert.match(result.body, /Crema viso 50 ml/);
  assert.deepEqual(body?.plugins, [{id:"file-parser",pdf:{engine:"mistral-ocr"}}]);
  const content = (body?.messages as Array<{content:Array<Record<string, unknown>>}>)[0]?.content;
  assert.equal(content?.[1]?.type, "file");
  assert.match(String(content?.[0]?.text),/quantità, misure e unità di misura/);
});

test("splits scanned PDFs over 40 pages into ordered OCR requests", async () => {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < 42; page++) pdf.addPage([300, 400]);
  const bytes = new Uint8Array(await pdf.save());
  const chunkPages: number[] = [];
  const ranges: string[] = [];
  const result = await ocrDocumentWithOpenRouter({
    bytes, mime: "application/pdf", name: "catalogo.pdf", model: "deepseek/deepseek-v4.1-flash",
    keyProvider: async () => "test-key",
    fetcher: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{content:Array<{type:string;file?:{file_data:string;filename:string}}>}> };
      const file = request.messages[0]!.content[1]!.file!;
      const chunk = await PDFDocument.load(Buffer.from(file.file_data.split(",")[1]!, "base64"));
      chunkPages.push(chunk.getPageCount());
      ranges.push(file.filename);
      return new Response(JSON.stringify({
        id: `gen-pdf-${chunkPages.length}`, model: "deepseek/deepseek-v4.1-flash", usage: {prompt_tokens: 20, completion_tokens: 10},
        choices: [{message: {content: "Testo OCR trascritto per la pagina del catalogo.", annotations: [{type: "file", file: {content: [
          {type: "text", text: `Contenuto chunk numero ${chunkPages.length} con evidenza OCR valida.`}
        ]}}]}}]
      }), {status: 200});
    }
  });
  assert.deepEqual(chunkPages, [40, 2]);
  assert.match(ranges[0]!, /p1-40/);
  assert.match(ranges[1]!, /p41-42/);
  assert.equal(result.pageCount, 42);
  assert.equal(result.pagesProcessed, 42);
  assert.equal(result.textTruncated, false);
  assert.match(result.body, /Pagine PDF 1–40/);
  assert.match(result.body, /Pagine PDF 41–42/);
});

test("keeps completed OCR segments when a later provider request fails", async () => {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < 42; page++) pdf.addPage([300, 400]);
  const bytes = new Uint8Array(await pdf.save());
  let requests = 0;
  let reservations = 0;
  const result = await ocrDocumentWithOpenRouter({
    bytes, mime: "application/pdf", name: "catalogo.pdf", model: "deepseek/deepseek-v4.1-flash",
    keyProvider: async () => "test-key", beforeRequest: async () => { reservations++; },
    fetcher: async () => {
      requests++;
      if (requests === 2) return new Response(JSON.stringify({error:{message:"temporary provider failure"}}), {status:500});
      return new Response(JSON.stringify({
        id: "gen-pdf-partial", model: "deepseek/deepseek-v4.1-flash", usage: {prompt_tokens: 20, completion_tokens: 10},
        choices: [{message: {annotations: [{type: "file", file: {content: [
          {type: "text", text: "Trascrizione valida del primo blocco OCR e testo conservato."}
        ]}}]}}]
      }), {status:200});
    }
  });
  assert.equal(requests, 2);
  assert.equal(reservations, 2);
  assert.equal(result.pagesProcessed, 40);
  assert.equal(result.textTruncated, true);
  assert.equal(result.partialFailure, true);
  assert.match(result.body, /primo blocco OCR/);

  let retryRequests = 0;
  let retryReservationCount = 0;
  const retried = await ocrDocumentWithOpenRouter({
    bytes, mime: "application/pdf", name: "catalogo.pdf", model: "deepseek/deepseek-v4.1-flash",
    keyProvider: async () => "test-key", resumeAfterPage: result.pagesProcessed!, previousBody: result.body,
    beforeRequest: async () => { retryReservationCount++; },
    fetcher: async (_input, init) => {
      retryRequests++;
      const request = JSON.parse(String(init?.body)) as { messages: Array<{content:Array<{file?:{filename:string}}>}> };
      assert.match(request.messages[0]!.content[1]!.file!.filename, /p41-42/);
      return new Response(JSON.stringify({
        id: "gen-pdf-resume", model: "deepseek/deepseek-v4.1-flash", usage: {prompt_tokens: 20, completion_tokens: 10},
        choices: [{message: {annotations: [{type: "file", file: {content: [
          {type: "text", text: "Trascrizione valida del secondo blocco OCR completato."}
        ]}}]}}]
      }), {status:200});
    }
  });
  assert.equal(retryRequests, 1);
  assert.equal(retryReservationCount, 1);
  assert.equal(retried.pagesProcessed, 42);
  assert.equal(retried.partialFailure, false);
  assert.equal(retried.textTruncated, false);
  assert.match(retried.body, /primo blocco OCR/);
  assert.match(retried.body, /secondo blocco OCR/);
});

test("reuses the local page-count preflight instead of parsing the PDF a second time", async () => {
  const pdf=await PDFDocument.create();pdf.addPage([300,400]);
  const bytes = new Uint8Array(await pdf.save());
  let requested = false;
  const result = await ocrDocumentWithOpenRouter({
    bytes, mime: "application/pdf", name: "catalogo.pdf", model: "deepseek/deepseek-v4.1-flash", pageCount: 1,
    keyProvider: async () => "test-key",
    fetcher: async () => {
      requested = true;
      return new Response(JSON.stringify({
        id: "gen-pdf-preflight", model: "deepseek/deepseek-v4.1-flash", usage: {prompt_tokens: 20, completion_tokens: 10},
        choices: [{message: {content: "Catalogo prodotti\nCrema viso 50 ml — € 19,90"}}]
      }), {status: 200});
    }
  });
  assert.equal(result.pageCount, 1);
  assert.equal(requested, true);
});

test("requires a configured key and rejects unrelated document types", async () => {
  const png = new Uint8Array([137,80,78,71,13,10,26,10]);
  const text = new TextEncoder().encode("testo valido");
  await assert.rejects(ocrDocumentWithOpenRouter({bytes:png,mime:"image/png",name:"pagina.png",model:"vision/model",keyProvider:async()=>null}),/chiave OpenRouter/);
  await assert.rejects(ocrDocumentWithOpenRouter({bytes:text,mime:"text/plain",name:"pagina.txt",model:"vision/model",keyProvider:async()=>"test"}),/solo per PDF e immagini/);
});
