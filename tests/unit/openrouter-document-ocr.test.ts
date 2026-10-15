import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { ocrDocumentWithOpenRouter, parsedDocumentImages, parsedDocumentText } from "../../lib/openrouter-document-ocr";

function pngChunk(type: string, body: Uint8Array) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(body.length + 12);
  output.writeUInt32BE(body.length, 0);
  name.copy(output, 4);
  Buffer.from(body).copy(output, 8);
  let crc = 0xffffffff;
  for (const byte of output.subarray(4, body.length + 8)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 8);
  return output;
}

function noisyPng(size: number, seed: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(size * size * 3);
  let state = (seed + 1) >>> 0;
  for (let index = 0; index < pixels.length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[index] = state & 0xff;
  }
  const scanlines = Buffer.alloc(size * (size * 3 + 1));
  for (let row = 0; row < size; row++) {
    scanlines[row * (size * 3 + 1)] = 0;
    pixels.copy(scanlines, row * (size * 3 + 1) + 1, row * size * 3, (row + 1) * size * 3);
  }
  // Make each page's image distinct so the PDF cannot share one image stream.
  scanlines[seed + 1] = (scanlines[seed + 1]! + seed + 1) & 0xff;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

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

test("recovers parsed OCR annotations from a downstream provider error", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  const bytes = new Uint8Array(await pdf.save());
  let requests = 0;
  const result = await ocrDocumentWithOpenRouter({
    bytes, mime: "application/pdf", name: "catalogo.pdf", model: "deepseek/deepseek-v4.1-flash",
    keyProvider: async () => "test-key",
    fetcher: async () => {
      requests++;
      return new Response(JSON.stringify({error:{
        message:"downstream provider failed",
        metadata:{file_annotations:[{type:"file",file:{content:[
          {type:"text",text:"Prodotto Aloe 250 ml, codice AL-250, prezzo 12,50 euro."}
        ]}}]}
      }}), {status:502});
    }
  });
  assert.equal(requests,1);
  assert.equal(result.pagesProcessed,1);
  assert.equal(result.partialFailure,false);
  assert.match(result.body,/codice AL-250/);
});

test("splits scanned PDFs into ordered OCR requests capped at ten pages", async () => {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < 22; page++) pdf.addPage([300, 400]);
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
  assert.deepEqual(chunkPages, [10, 10, 2]);
  assert.match(ranges[0]!, /p1-10/);
  assert.match(ranges[1]!, /p11-20/);
  assert.match(ranges[2]!, /p21-22/);
  assert.equal(result.pageCount, 22);
  assert.equal(result.pagesProcessed, 22);
  assert.equal(result.textTruncated, false);
  assert.match(result.body, /Pagine PDF 1–10/);
  assert.match(result.body, /Pagine PDF 11–20/);
  assert.match(result.body, /Pagine PDF 21–22/);
});

test("OCR only includes selected scan pages and prepends the preserved native text",async()=>{
 const pdf=await PDFDocument.create();
 for(let page=0;page<6;page++)pdf.addPage([300,400]);
 const bytes=new Uint8Array(await pdf.save());
 let sentPageCount=0;let filename="";
 const result=await ocrDocumentWithOpenRouter({
  bytes,mime:"application/pdf",name:"catalogo.pdf",model:"deepseek/deepseek-v4.1-flash",pageCount:6,
  pagesToOcr:[2,5],nativeText:"[Pagina PDF 1]\nTesto nativo già estratto.",
  keyProvider:async()=>"test-key",
  fetcher:async(_input,init)=>{
   const request=JSON.parse(String(init?.body)) as {messages:Array<{content:Array<{file?:{file_data:string;filename:string}}>}>};
   const file=request.messages[0]!.content[1]!.file!;filename=file.filename;
   const subset=await PDFDocument.load(Buffer.from(file.file_data.split(",")[1]!,"base64"));sentPageCount=subset.getPageCount();
   return new Response(JSON.stringify({id:"gen-scan-subset",model:"deepseek/deepseek-v4.1-flash",usage:{prompt_tokens:20,completion_tokens:10},choices:[{message:{annotations:[{type:"file",file:{content:[{type:"text",text:"OCR delle sole pagine scansionate."}]}}]}}]}),{status:200});
  }
 });
 assert.equal(sentPageCount,2);
 assert.match(filename,/p2_5\.pdf/);
 assert.match(result.body,/Testo nativo già estratto/);
 assert.match(result.body,/Pagine PDF 2, 5/);
 assert.match(result.body,/OCR delle sole pagine scansionate/);
 assert.equal(result.pageCount,6);
 assert.equal(result.pagesProcessed,6);
});

test("mixed-PDF text limits do not stop OCR of the remaining selected pages",async()=>{
 const pdf=await PDFDocument.create();
 for(let page=0;page<12;page++)pdf.addPage([300,400]);
 const bytes=new Uint8Array(await pdf.save());
 let requests=0;
 const result=await ocrDocumentWithOpenRouter({
  bytes,mime:"application/pdf",name:"catalogo.pdf",model:"deepseek/deepseek-v4.1-flash",pageCount:12,
  pagesToOcr:Array.from({length:12},(_,index)=>index+1),nativeText:"Testo nativo. ".repeat(5000),
  keyProvider:async()=>"test-key",
  fetcher:async()=>{
   requests++;
   return new Response(JSON.stringify({id:`gen-truncated-${requests}`,model:"deepseek/deepseek-v4.1-flash",usage:{prompt_tokens:20,completion_tokens:10},choices:[{message:{annotations:[{type:"file",file:{content:[{type:"text",text:"Testo OCR di prova. ".repeat(2500)}]}}]}}]}),{status:200});
  }
 });
 assert.equal(requests,2,"all selected page segments must be sent even after the body limit is reached");
 assert.equal(result.pagesProcessed,12,"all native and scanned pages were processed");
 assert.equal(result.partialFailure,false);
 assert.equal(result.textTruncated,true);
 assert.equal(result.body.length,80_000);
});

test("resuming partial OCR preserves its previously extracted body",async()=>{
 const pdf=await PDFDocument.create();
 for(let page=0;page<12;page++)pdf.addPage([300,400]);
 const bytes=new Uint8Array(await pdf.save());
 const previousBody="Testo nativo. ".repeat(3200)+"\n\n[Pagine PDF 1–8]\nOCR già completato.";
 const result=await ocrDocumentWithOpenRouter({
  bytes,mime:"application/pdf",name:"catalogo.pdf",model:"deepseek/deepseek-v4.1-flash",pageCount:12,
  pagesToOcr:[9,10,11,12],resumeAfterPage:8,previousBody,
  keyProvider:async()=>"test-key",
  fetcher:async()=>new Response(JSON.stringify({id:"gen-resume",model:"deepseek/deepseek-v4.1-flash",usage:{prompt_tokens:20,completion_tokens:10},choices:[{message:{annotations:[{type:"file",file:{content:[{type:"text",text:"OCR delle pagine rimanenti del documento."}]}}]}}]}),{status:200})
 });
 assert.match(result.body,/OCR già completato/);
 assert.match(result.body,/OCR delle pagine rimanenti/);
 assert.equal(result.pagesProcessed,12);
 assert.equal(result.partialFailure,false);
});

test("splits OCR PDF segments by serialized size as well as page count", async () => {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < 15; page++) {
    const image = await pdf.embedPng(noisyPng(500, page));
    const target = pdf.addPage([500, 500]);
    target.drawImage(image, { x: 0, y: 0, width: 500, height: 500 });
  }
  const bytes = new Uint8Array(await pdf.save());
  assert.ok(bytes.byteLength > 10_000_000, "fixture must exceed the per-segment 10 MB bound");
  assert.ok(bytes.byteLength < 64 * 1024 * 1024, "fixture must remain below the document upload bound");

  const chunks: Array<{pages: number; bytes: number; name: string}> = [];
  const result = await ocrDocumentWithOpenRouter({
    bytes, mime: "application/pdf", name: "catalogo-grande.pdf", model: "deepseek/deepseek-v4.1-flash",
    keyProvider: async () => "test-key",
    fetcher: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {messages:Array<{content:Array<{file?:{file_data:string;filename:string}}>}>};
      const file = request.messages[0]!.content[1]!.file!;
      const chunkBytes = Buffer.from(file.file_data.split(",")[1]!, "base64");
      const chunk = await PDFDocument.load(chunkBytes);
      chunks.push({pages: chunk.getPageCount(), bytes: chunkBytes.byteLength, name: file.filename});
      return new Response(JSON.stringify({
        id: `gen-large-${chunks.length}`, model: "deepseek/deepseek-v4.1-flash", usage: {prompt_tokens: 20, completion_tokens: 10},
        choices: [{message: {annotations: [{type: "file", file: {content: [
          {type: "text", text: `Testo OCR valido dal segmento ${chunks.length} del documento sintetico.`}
        ]}}]}}]
      }), {status: 200});
    }
  });

  assert.ok(chunks.length > 1, "size bound should split the 15-page document");
  assert.deepEqual(chunks.map(chunk => chunk.pages).reduce((sum, pages) => sum + pages, 0), 15);
  assert.ok(chunks.every(chunk => chunk.bytes <= 10_000_000), "no serialized OCR segment may exceed 10 MB");
  let nextPage = 1;
  for (const chunk of chunks) {
    const range = /-p(\d+)-(\d+)\.pdf$/u.exec(chunk.name);
    assert.ok(range, `expected page range in ${chunk.name}`);
    assert.equal(Number(range[1]), nextPage, "segments must not overlap or skip pages");
    nextPage = Number(range[2]) + 1;
  }
  assert.equal(nextPage, 16);
  assert.equal(result.pagesProcessed, 15);
  assert.equal(result.partialFailure, false);
});

test("segments large scanned PDFs before sending them through API OCR", async () => {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < 30; page++) {
    const image = await pdf.embedPng(noisyPng(500, page + 30));
    pdf.addPage([500, 500]).drawImage(image, { x: 0, y: 0, width: 500, height: 500 });
  }
  const bytes = new Uint8Array(await pdf.save());
  assert.ok(bytes.byteLength > 20 * 1024 * 1024, "fixture must exercise the large-PDF optimization");
  const sentPages: number[] = [];
  let firstChunkBytes = 0;
  const result = await ocrDocumentWithOpenRouter({
    bytes, mime: "application/pdf", name: "scansione.pdf", model: "deepseek/deepseek-v4.1-flash",
    keyProvider: async () => "test-key",
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {messages:Array<{content:Array<{file?:{file_data:string}}>}>};
      const data = body.messages[0]!.content[1]!.file!.file_data;
      const sentBytes = Buffer.from(data.split(",")[1]!, "base64").byteLength;
      const sentPdf = await PDFDocument.load(Buffer.from(data.split(",")[1]!, "base64"));
      sentPages.push(sentPdf.getPageCount());
      if(sentPages.length===1)firstChunkBytes=sentBytes;
      return new Response(JSON.stringify({
        id: `gen-segmented-${sentPages.length}`, model: "deepseek/deepseek-v4.1-flash", usage: {prompt_tokens: 20, completion_tokens: 10},
        choices: [{message: {annotations: [{type: "file", file: {content: [{type: "text", text: "Testo OCR remoto delle trenta pagine."}]}}]}}]
      }), {status: 200});
    }
  });
  assert.deepEqual(sentPages,[10,10,10]);
  assert.ok(firstChunkBytes < bytes.byteLength / 2, "the API receives a bounded PDF segment");
  assert.equal(result.pageCount, 30);
  assert.equal(result.pagesProcessed, 30);
  assert.equal(result.partialFailure, false);
});

test("keeps completed OCR segments when a later provider request fails", async () => {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < 20; page++) pdf.addPage([300, 400]);
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
  assert.equal(result.pagesProcessed, 10);
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
      assert.match(request.messages[0]!.content[1]!.file!.filename, /p11-20/);
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
  assert.equal(retried.pagesProcessed, 20);
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
