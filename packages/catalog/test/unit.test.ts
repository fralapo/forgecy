import { describe, expect, it } from "vitest";
import {
  applyMapping,
  approvalBlockers,
  chunkPages,
  completenessOf,
  detectClaims,
  htmlToText,
  inspectFile,
  isWooCommerceExport,
  matchMaterial,
  mergeCandidates,
  parseCsv,
  parseProductText,
  parseXlsx,
  productsToCsv,
  assertSafeOfficeFile,
  readPdfText,
  readZip,
  safeEntryPath,
  sanitizeDraft,
  sanitizePath,
  sensitiveFields,
  sniffFile,
  suggestMapping,
  type Candidate,
} from "../src";
import { csvCell, englishCsvLabels } from "../src/products/csv-export";
import { fieldDefs } from "../src/products/fields";
import { LOCALES } from "@forgecy/core";
import { overlappingZip, zipArchive } from "@forgecy/core/testing/archives";
import { messagesFor } from "@forgecy/i18n";
import { makePdf, makeXlsx, makeZip, PNG } from "./fixtures";

const WOO_HEADERS = [
  "ID",
  "Type",
  "SKU",
  "Name",
  "Published",
  "Is featured?",
  "Visibility in catalog",
  "Short description",
  "Description",
  "Tax status",
  "In stock?",
  "Sale price",
  "Regular price",
  "Categories",
  "Tags",
  "Images",
  "Parent",
  "Attribute 1 name",
  "Attribute 1 value(s)",
];

describe("sniffFile", () => {
  it("recognizes formats from magic bytes and extension", () => {
    expect(sniffFile("a.pdf", 10, Buffer.from("%PDF-1.4")).kind).toBe("pdf");
    expect(sniffFile("a.png", 10, PNG).kind).toBe("image");
    expect(sniffFile("a.csv", 10, Buffer.from("a;b\n1;2")).format).toBe("csv");
    expect(sniffFile("a.zip", 10, Buffer.from([0x50, 0x4b, 0x03, 0x04])).kind).toBe("archive");
    expect(sniffFile("a.xlsx", 10, Buffer.from([0x50, 0x4b, 0x03, 0x04])).kind).toBe("sheet");
  });
  it("refuses renamed or unknown files with a code", () => {
    expect(sniffFile("catalog.rar", 10, Buffer.from("Rar!")).code).toBe("IMPORT-INVALID");
    expect(sniffFile("photo.pdf", 10, PNG).code).toBe("IMPORT-INVALID");
    expect(sniffFile("virus.csv", 10, Buffer.from([0x4d, 0x5a, 0, 0])).code).toBe("IMPORT-INVALID");
  });
  it("enforces per-kind limits", () => {
    expect(sniffFile("big.png", 21 * 1024 * 1024, PNG).code).toBe("IMPORT-TOO-LARGE");
    expect(
      sniffFile("big.zip", 201 * 1024 * 1024, Buffer.from([0x50, 0x4b, 3, 4])).message,
    ).toContain("200 MB");
  });
});

describe("CSV and XLSX", () => {
  // Italian headers and an accented Italian word: the Windows-1252 path exists for Italian Excel exports.
  it("reads semicolon CSV in Windows-1252", () => {
    const bytes = Buffer.from([
      ...Buffer.from("Nome;Prezzo\nCaff"),
      0xe8,
      ...Buffer.from(";1,50\n"),
    ]);
    const sheet = parseCsv(bytes, "listino.csv");
    expect(sheet.encoding).toBe("windows-1252");
    expect(sheet.delimiter).toBe(";");
    expect(sheet.rows[0]).toEqual(["Caffè", "1,50"]);
  });
  it("strips the BOM and handles quoted commas", () => {
    const sheet = parseCsv(
      Buffer.from('\uFEFFName,Description\n"Cream, 50 ml","Moisturizes"\n'),
      "x.csv",
    );
    expect(sheet.headers).toEqual(["Name", "Description"]);
    expect(sheet.rows[0]![0]).toBe("Cream, 50 ml");
  });
  it("refuses more than 10,000 rows", () => {
    const body = "Name\n" + Array.from({ length: 10_050 }, (_, i) => `P${i}`).join("\n");
    expect(() => parseCsv(Buffer.from(body), "big.csv")).toThrow(/limit is 10,000/);
  });
  it("reads the first sheet of an XLSX", async () => {
    const data = await makeXlsx([
      ["Name", "SKU"],
      ["Face cream", "RS-CV-050"],
    ]);
    const sheet = await parseXlsx(data, "p.xlsx");
    expect(sheet.rows).toEqual([["Face cream", "RS-CV-050"]]);
  });
});

describe("mapping", () => {
  it("recognizes the WooCommerce export and maps it", () => {
    expect(isWooCommerceExport(WOO_HEADERS)).toBe(true);
    const m = suggestMapping(WOO_HEADERS);
    expect(m.preset).toBe("woocommerce");
    const at = (h: string) => m.columns[WOO_HEADERS.indexOf(h)];
    expect(at("Name")).toBe("name");
    expect(at("SKU")).toBe("sku");
    expect(at("Short description")).toBe("shortDescription");
    expect(at("Regular price")).toBe("price");
    expect(at("Sale price")).toBe("ignore");
    expect(at("Images")).toBe("image");
  });
  it("turns WooCommerce rows into products with variants, plain text and no invented price", () => {
    const row = (o: Record<string, string>) => WOO_HEADERS.map((h) => o[h] ?? "");
    const sheet = {
      headers: WOO_HEADERS,
      rows: [
        row({
          ID: "10",
          Type: "variable",
          SKU: "RS-CV",
          Name: "Face cream",
          "Short description": "<p>Deeply <strong>moisturizing</strong></p>",
          Categories: "Face > Creams, Offers",
          "Attribute 1 name": "Size",
          "Attribute 1 value(s)": "50 ml, 75 ml",
        }),
        row({
          ID: "11",
          Type: "variation",
          SKU: "RS-CV-050",
          Name: "Face cream - 50 ml",
          Parent: "id:10",
          "Regular price": "19,90",
          "Attribute 1 name": "Size",
          "Attribute 1 value(s)": "50 ml",
        }),
        row({ ID: "12", Type: "simple", SKU: "RS-SV", Name: "", Categories: "Face" }),
      ],
    };
    const { rows, rejected } = applyMapping(sheet, suggestMapping(WOO_HEADERS), {
      kind: "csv",
      fileName: "wc.csv",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.draft.shortDescription).toBe("Deeply moisturizing");
    expect(rows[0]!.draft.category).toBe("Creams");
    expect(rows[0]!.draft.price).toBeUndefined();
    expect(rows[0]!.draft.variants).toContainEqual({
      attribute: "Size",
      value: "50 ml",
      sku: "RS-CV-050",
    });
    expect(rows[0]!.sources.shortDescription).toMatchObject({
      row: 2,
      column: "Short description",
    });
    expect(rejected).toEqual([
      {
        row: 4,
        reason: "Row 4: missing name",
        ref: { key: "products.discards.rowNoName", values: { row: 4 } },
      },
    ]);
  });
  it("keeps the price only when it is in the file, normalized", () => {
    expect(sanitizeDraft({ price: "1.234,50 €" }).price).toBe("1234.50");
    expect(sanitizeDraft({ price: "on request" }).price).toBeUndefined();
    expect(sanitizeDraft({ currency: "€" }).currency).toBe("EUR");
  });
});

describe("ZIP guard", () => {
  it("lists entries, skips junk and refuses path traversal", async () => {
    const zip = await makeZip([
      { path: "cream/photo.png", data: PNG },
      { path: "__MACOSX/cream/._photo.png", data: "x" },
      { path: ".DS_Store", data: "x" },
    ]);
    const listing = await readZip(zip);
    expect(listing.entries.map((e) => e.path)).toEqual(["cream/photo.png"]);
    expect(safeEntryPath("../../etc/passwd")).toBeNull();
    expect(safeEntryPath("/abs/x")).toBeNull();
    expect(safeEntryPath("C:/x")).toBeNull();
    expect(sanitizePath("../../a/./b/../c.png")).toBe("a/b/c.png");
  });
  it("stops a zip bomb by compression ratio and total size", async () => {
    const bomb = await makeZip([{ path: "zeros.txt", data: Buffer.alloc(8 * 1024 * 1024) }]);
    await expect(readZip(bomb)).rejects.toMatchObject({ code: "IMPORT-TOO-LARGE" });
    const many = await makeZip(
      Array.from({ length: 4 }, (_, i) => ({
        path: `f${i}.txt`,
        data: Buffer.alloc(1024, 65),
        store: true,
      })),
    );
    await expect(readZip(many, { maxUncompressedBytes: 2048 })).rejects.toMatchObject({
      code: "IMPORT-TOO-LARGE",
    });
    await expect(readZip(many, { maxEntries: 2 })).rejects.toMatchObject({
      code: "IMPORT-TOO-LARGE",
    });
  });
  it("summarizes an archive for the file list", async () => {
    const zip = await makeZip([
      { path: "a/1.png", data: PNG },
      { path: "a/info.txt", data: "Name: Cream" },
      { path: "price-list.csv", data: "Name\nCream" },
      { path: "virus.exe", data: "MZ" },
    ]);
    const res = await inspectFile("zip", "photos.zip", { data: zip });
    expect(res.valid).toBe(true);
    expect(res.summary).toBe(
      "ZIP: 1 sheets, 1 images, 1 texts · 1 files ignored: formats not allowed",
    );
  });
});

describe("Office file guard", () => {
  const MB = 1024 * 1024;
  it("accepts a normal spreadsheet", async () => {
    const xlsx = await makeXlsx([["Name"], ["Cream"]]);
    await expect(assertSafeOfficeFile(xlsx, "ok.xlsx")).resolves.toBeUndefined();
  });
  it("stops a file whose central directory lies about a part size", async () => {
    const lying = zipArchive([
      { name: "xl/sharedStrings.xml", data: Buffer.alloc(64 * MB), declaredSize: 4096 },
    ]);
    await expect(assertSafeOfficeFile(lying, "lie.xlsx")).rejects.toMatchObject({
      code: "IMPORT-INVALID",
    });
  });
  it("stops overlapping stored parts that add up past the cap", async () => {
    const overlap = overlappingZip({
      data: Buffer.alloc(MB, 65),
      entries: 150,
      store: true,
      declaredSize: MB,
      name: (i) => `xl/worksheets/sheet${i}.xml`,
    });
    await expect(assertSafeOfficeFile(overlap, "overlap.xlsx")).rejects.toMatchObject({
      code: "IMPORT-TOO-LARGE",
    });
  });
  it("stops a deflate bomb", async () => {
    const bomb = zipArchive([{ name: "word/document.xml", data: Buffer.alloc(101 * MB) }]);
    await expect(assertSafeOfficeFile(bomb, "bomb.docx")).rejects.toMatchObject({
      code: "IMPORT-TOO-LARGE",
    });
  });
  it("stops a file with too many entries", async () => {
    const many = zipArchive(Array.from({ length: 5_001 }, (_, i) => ({ name: `f${i}.xml` })));
    await expect(assertSafeOfficeFile(many, "many.xlsx")).rejects.toMatchObject({
      code: "IMPORT-TOO-LARGE",
    });
  });
  it("refuses a file that is not a ZIP", async () => {
    await expect(assertSafeOfficeFile(Buffer.from("nope"), "x.xlsx")).rejects.toMatchObject({
      code: "IMPORT-INVALID",
    });
  });
});

describe("PDF", () => {
  it("reads text per page and chunks it with page numbers", async () => {
    const pdf = await readPdfText(
      makePdf(["Face cream 50 ml\nCode RS-CV-050", "Night serum"]),
      "price-list.pdf",
    );
    expect(pdf.totalPages).toBe(2);
    expect(pdf.pages[0]).toContain("RS-CV-050");
    const chunks = chunkPages(pdf.pages, 10_000);
    expect(chunks[0]!.text).toContain('<page number="2">');
  });
  it("flags a broken PDF as unreadable", async () => {
    await expect(readPdfText(Buffer.from("%PDF-1.4 garbage"), "x.pdf")).rejects.toMatchObject({
      code: "IMPORT-PDF-UNREADABLE",
    });
  });
});

describe("folders and texts", () => {
  it("pairs images by folder, SKU and name, leaving the rest to assign", () => {
    const known: Candidate[] = [
      {
        draft: { name: "Face cream", sku: "RS-CV-050" },
        sources: {},
        confidence: {},
        images: [],
        origin: { kind: "csv" },
      },
    ];
    const res = matchMaterial(
      [
        { id: "1", path: "RS-CV-050_front.jpg", kind: "image" },
        { id: "2", path: "photos/serum/1.jpg", kind: "image" },
        {
          id: "3",
          path: "photos/serum/info.txt",
          kind: "text",
          textFields: { name: "Night serum", category: "Face" },
        },
        { id: "4", path: "IMG_0231.jpg", kind: "image" },
        { id: "5", path: "face cream.png", kind: "image" },
      ],
      known,
      (m) => ({ kind: "text", fileName: m.path }),
    );
    expect(known[0]!.images.map((i) => [i.fileId, i.method])).toEqual([
      ["1", "sku"],
      ["5", "filename"],
    ]);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]!.draft.name).toBe("Night serum");
    expect(res.candidates[0]!.images[0]).toMatchObject({ fileId: "2", method: "folder" });
    expect(res.unassigned).toEqual(["4"]);
  });
  // Italian labels: product text files from Italian clients.
  it("reads 'Label: value' product texts", () => {
    const t = parseProductText(
      "Nome: Crema viso\nCodice: RS-CV-050\nIngredienti: acqua; glicerina\n\nUna crema leggera.",
    );
    expect(t).toMatchObject({
      name: "Crema viso",
      sku: "RS-CV-050",
      materials: "acqua; glicerina",
      longDescription: "Una crema leggera.",
    });
  });
  it("merges sources by SKU without overwriting the first value", () => {
    const merged = mergeCandidates([
      {
        draft: { name: "Cream", sku: "rs-cv-050", shortDescription: "From the sheet" },
        sources: {},
        confidence: {},
        images: [],
        origin: { kind: "csv" },
      },
      {
        draft: {
          name: "Face cream",
          sku: "RS CV 050",
          shortDescription: "From the PDF",
          usage: ["Morning"],
        },
        sources: {},
        confidence: {},
        images: [],
        origin: { kind: "pdf" },
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.draft).toMatchObject({
      shortDescription: "From the sheet",
      usage: ["Morning"],
    });
  });
});

describe("rules", () => {
  // Italian claim wording: the keyword lists match Italian client texts.
  it("detects claims and blocks approval until accepted", () => {
    expect(detectClaims("Dermatologicamente testato, garanzia 2 anni")).toEqual([
      "health",
      "warranty",
    ]);
    const draft = { name: "Cream", category: "Face", shortDescription: "Biodegradabile al 100%" };
    const flags = sensitiveFields(draft);
    expect(flags.shortDescription).toEqual(["environmental"]);
    const meta = {
      shortDescription: {
        truth: "observed" as const,
        source: { kind: "pdf" as const },
        confidence: "medium" as const,
        sensitive: flags.shortDescription,
      },
    };
    expect(approvalBlockers(draft, meta)[0]).toContain("sensitive field");
    expect(
      approvalBlockers(draft, { shortDescription: { ...meta.shortDescription, acceptedBy: "u1" } }),
    ).toEqual([]);
    expect(approvalBlockers({ name: "Cream", price: "10" }, {})[0]).toBe(
      "Fill in category, short description",
    );
  });
  it("never counts price for completeness", () => {
    const base = { name: "Cream", category: "Face", shortDescription: "x", usage: ["Evening"] };
    expect(completenessOf(base, 1).level).toBe("complete");
    expect(completenessOf({ name: "Cream" }, 0).level).toBe("minimal");
  });
  it("treats client text as text: strips HTML and shortcodes", () => {
    expect(
      htmlToText('<script>alert(1)</script><p>Hello&nbsp;<b>world</b></p>[gallery ids="1"]'),
    ).toBe("Hello world");
  });
  it("neutralizes formulas in CSV exports", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(productsToCsv([]).startsWith("\uFEFFStatus;Name")).toBe(true);
  });
  it("re-imports its own CSV export in every interface language", () => {
    for (const locale of LOCALES) {
      const t = messagesFor(locale).products;
      const header = productsToCsv([], {
        ...englishCsvLabels,
        status: t.csv.status,
        source: t.csv.source,
        field: (key) => t.fields[key],
      })
        .slice(1)
        .trim()
        .split(";")
        .map((h) => h.replace(/^"|"$/g, ""));
      const { columns } = suggestMapping(header);
      for (const def of fieldDefs)
        expect([locale, columns[header.indexOf(t.fields[def.key])]]).toEqual([locale, def.key]);
    }
  });
});
