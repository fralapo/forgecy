import { sep } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import type { PositionedPdfTextItem } from "./catalog-import";

/** Configure PDF.js' bundled OpenJPEG decoder so embedded JPEG2000 assets can render in Node. */
export function pdfWasmUrl() {
  // Keep the WASM runtime path out of Turbopack's static module graph: importing
  // the .wasm file directly makes Turbopack generate an unresolved loader.
  return pathToFileURL(`${process.cwd()}${sep}node_modules${sep}pdfjs-dist${sep}wasm${sep}`).href;
}

export async function createPdfParser(bytes: Uint8Array) {
  await import("pdf-parse/worker");
  return new PDFParse({ data: Uint8Array.from(bytes), wasmUrl: pdfWasmUrl() });
}

/** Read raw PDF.js text coordinates through pdf-parse's loaded document for layout-aware tables. */
export async function getPositionedPdfText(parser:Awaited<ReturnType<typeof createPdfParser>>,pageNumber:number):Promise<PositionedPdfTextItem[]>{
 // pdf-parse does not currently expose positioned text publicly; keep its internal access contained here.
 const runtime=parser as unknown as {doc?:{getPage(n:number):Promise<{getTextContent():Promise<{items:unknown[]}>}>}};
 if(!runtime.doc)throw new Error("PDF document has not been loaded");
 const page=await runtime.doc.getPage(pageNumber);
 const content=await page.getTextContent();
 return content.items.flatMap(item=>{
  if(!item||typeof item!=="object"||!("str" in item)||typeof item.str!=="string"||!("transform" in item)||!Array.isArray(item.transform))return [];
  const transform=item.transform as unknown[];
  const x=transform[4],y=transform[5];
  return typeof x==="number"&&typeof y==="number"?[{str:item.str,x,y}]:[];
 });
}
