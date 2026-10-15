import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { applyNativeImageAssociations, nativeImageAssociationSchema } from "../../lib/catalog-image-association";
import { extractDocumentWithMetadata, extractNativeCatalogImages } from "../../lib/document-extract";
import type { CatalogProduct } from "../../lib/catalog-import";
import { createPdfParser, getPositionedPdfText, pdfWasmUrl } from "../../lib/pdf-runtime";
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

async function productPdf(names: string[], imageCountForProduct: number[], codes: string[] = []) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < names.length; index++) {
    const y = 650 - index * 210;
    page.drawText(names[index]!, { x: 40, y: y + 40, size: 16, font });
    if (codes[index]) page.drawText("Cod." + codes[index], { x: 360, y: y - 10, size: 9, font });
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

test("native PDF images stay page-scoped and ambiguous surplus images are excluded", async () => {
  assert.match(pdfWasmUrl(), /pdfjs-dist[\\/]wasm[\\/]$/u);
  const names = ["Alpha Cleaner", "Beta Polish", "Gamma Glass"];
  const parser = await createPdfParser(await productPdf(names, [1, 1, 1]));
  try {
    const extracted = await parser.getText({ first: 1, pageJoiner: "" });
    const products: CatalogProduct[] = names.map(name => ({
      name, description: "", price: null, currency: "EUR", nameQuote: name, descriptionQuote: name, priceQuote: "",
      existingOfferId: null, imageIndex: null,
    }));
    const images = await extractNativeCatalogImages(parser, extracted.pages, "catalogo.pdf", bodyFor(names), new Map([[1, products]]));
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
    const product: CatalogProduct = {
      name: names[0]!, description: "", price: null, currency: "EUR", nameQuote: names[0]!, descriptionQuote: names[0]!, priceQuote: "",
      existingOfferId: null, imageIndex: null,
    };
    const images = await extractNativeCatalogImages(ambiguous, extracted.pages, "catalogo.pdf", bodyFor([names[0]!]), new Map([[1, [product]]]));
    assert.equal(images.length, 0);
  } finally {
    await ambiguous.destroy();
  }
});

test("mixed PDFs with a full-page scan request API OCR even when other pages contain native text",async()=>{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 const textPage=doc.addPage([450,500]);
 textPage.drawText("Catalogo completo con testo nativo sufficiente per superare il controllo di leggibilita.",{x:30,y:450,size:12,font});
 const scannedPage=doc.addPage([450,500]);
 const image=await doc.embedPng(solidPng(8,8,[235,235,235]));
 scannedPage.drawImage(image,{x:0,y:0,width:450,height:500});
 const result=await extractDocumentWithMetadata(await doc.save(),"application/pdf","catalogo-misto.pdf");
 assert.equal(result.pageCount,2);
 assert.equal(result.extraction.status,"error");
 assert.equal(result.extraction.error,"PDF con pagine scansionate: serve OCR tramite API");
});

test("native PDF images match product codes found in offer descriptions", async () => {
  const names = ["Alpha Cleaner", "Beta Polish"];
  const codes = ["DD074", "DD080"];
  const parser = await createPdfParser(await productPdf(names, [1, 1], codes));
  try {
    const extracted = await parser.getText({ first: 1, pageJoiner: "" });
    const products: CatalogProduct[] = names.map((name, index) => ({
      name, description: codes[index] + " — 750 ML", price: null, currency: "EUR",
      nameQuote: name, descriptionQuote: codes[index] + " — 750 ML", priceQuote: "",
      existingOfferId: null, imageIndex: null,
    }));
    const items = await getPositionedPdfText(parser, 1);
    const images = await extractNativeCatalogImages(
      parser, extracted.pages, "catalogo.pdf", bodyFor(names),
      new Map([[1, products]]), new Map([[1, items]]),
    );
    assert.equal(images.length, 2);
    assert.deepEqual(images.map(image => image.candidateProductNames), [[names[0]], [names[1]]]);
  } finally {
    await parser.destroy();
  }
});

test("native catalog images are retained when one family photo represents several priced variants", async () => {
  const names = ["15÷35 3,5 168 (U02820301)", "35÷50 4 202 (U02820302)", "50÷80 5 280 (U02820303)"];
  const parser = await createPdfParser(await productPdf(names, [1, 0, 0]));
  try {
    const extracted = await parser.getText({ first: 1, pageJoiner: "" });
    const candidates: CatalogProduct[] = names.map(name => ({
      name, description: "", price: null, currency: "EUR", nameQuote: name, descriptionQuote: name, priceQuote: "",
      existingOfferId: null, imageIndex: null,
    }));
    const images = await extractNativeCatalogImages(
      parser, extracted.pages, "catalogo.pdf", "Catalogo chiavi USAG", new Map([[1, candidates]]),
    );
    assert.equal(images.length, 1);
    assert.deepEqual(images[0]?.candidateProductNames, names);
  } finally {
    await parser.destroy();
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

test("native image association schema accepts large pages with many priced variants", () => {
  const associations = Array.from({length: 44}, (_, index) => ({
    product_name: `Product variant ${index + 1}`,
    image_index: index < 7 ? index : null,
  }));
  assert.equal(nativeImageAssociationSchema.safeParse({associations}).success, true);
});
