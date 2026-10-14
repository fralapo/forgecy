import { sep } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";

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
