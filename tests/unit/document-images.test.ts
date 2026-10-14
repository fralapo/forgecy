import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { applyNativeImageAssociations } from "../../lib/catalog-image-association";
import { extractNativeCatalogImages } from "../../lib/document-extract";
import type { CatalogProduct } from "../../lib/catalog-import";
import { createPdfParser, pdfWasmUrl } from "../../lib/pdf-runtime";
import type { DocumentImage } from "../../lib/document-image";

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Uint8Array) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(body.length + 12);
  output.writeUInt32BE(body.length, 0);
  name.copy(output, 4);
  Buffer.from(body).copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, body.length + 8)), body.length + 8);
  return output;
}

function solidPng(width: number, height: number, color: [number, number, number]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * (width * 3 + 1) + 1 + x * 3;
      scanlines[start] = color[0];
      scanlines[start + 1] = color[1];
      scanlines[start + 2] = color[2];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function productPdf(names: string[], imageCountForProduct: number[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < names.length; index++) {
    const y = 650 - index * 210;
    page.drawText(names[index]!, { x: 40, y: y + 40, size: 16, font });
    for (let image = 0; image < imageCountForProduct[index]!; image++) {
      const color: [number, number, number] = [(index * 80 + image * 25 + 40) % 255, (index * 50 + image * 30 + 60) % 255, (index * 35 + image * 40 + 80) % 255];
      const asset = await pdf.embedPng(solidPng(120, 200, color));
      page.drawImage(asset, { x: 360 + image * 100, y, width: 80, height: 132 });
    }
  }
  return new Uint8Array(await pdf.save());
}

const bodyFor = (names: string[]) => [
  "Product,Price",
  ...names.map((name, index) => `${name},${index + 1}.00`),
].join("\n");

test("native PDF product images decode and stay limited to one-to-one text/image pages", async () => {
  assert.match(pdfWasmUrl(), /pdfjs-dist[\\/]wasm[\\/]$/u);
  const names = ["Alpha Cleaner", "Beta Polish", "Gamma Glass"];
  const parser = await createPdfParser(await productPdf(names, [1, 1, 1]));
  try {
    const extracted = await parser.getText({ first: 1, pageJoiner: "" });
    const images = await extractNativeCatalogImages(parser, extracted.pages, "catalogo.pdf", bodyFor(names));
    assert.equal(images.length, 3);
    assert.deepEqual(images.map(image => image.origin), ["native-pdf", "native-pdf", "native-pdf"]);
    assert.deepEqual(images.map(image => image.pageNumber), [1, 1, 1]);
    assert.deepEqual(images[0]?.candidateProductNames, names);
    assert.match(images[0]?.dataUrl || "", /^data:image\/png;base64,/u);
  } finally {
    await parser.destroy();
  }

  const ambiguous = await createPdfParser(await productPdf([names[0]!], [2]));
  try {
    const extracted = await ambiguous.getText({ first: 1, pageJoiner: "" });
    const images = await extractNativeCatalogImages(ambiguous, extracted.pages, "catalogo.pdf", bodyFor([names[0]!]));
    assert.equal(images.length, 0);
  } finally {
    await ambiguous.destroy();
  }
});

test("native image associations reject products outside the page evidence and duplicate image reuse", () => {
  const products: CatalogProduct[] = ["Alpha Cleaner", "Beta Polish"].map(name => ({
    name, description: "", price: null, currency: "EUR", nameQuote: name, descriptionQuote: "", priceQuote: "",
    existingOfferId: null, imageIndex: null,
  }));
  const image = (pageNumber: number, candidateProductNames: string[]): DocumentImage => ({
    dataUrl: "data:image/png;base64,AA==", mime: "image/png", sha256: String(pageNumber).padStart(64, "0"),
    origin: "native-pdf", pageNumber, candidateProductNames,
  });
  const images = [image(1, ["Alpha Cleaner", "Beta Polish"]), image(2, ["Alpha Cleaner"])];
  const result = applyNativeImageAssociations(products, images, [
    { product_name: "Beta Polish", image_index: 0 },
    { product_name: "Alpha Cleaner", image_index: 1 },
    { product_name: "Unknown", image_index: 0 },
  ]);
  assert.deepEqual(result.map(product => product.imageIndex), [1, 0]);

  const conflicting = applyNativeImageAssociations(products, [images[0]!], [
    { product_name: "Alpha Cleaner", image_index: 0 },
    { product_name: "Beta Polish", image_index: 0 },
  ]);
  assert.deepEqual(conflicting.map(product => product.imageIndex), [0, null]);
});
