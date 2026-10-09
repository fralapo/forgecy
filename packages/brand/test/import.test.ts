import { overlappingZip, pdfWithPages, zipArchive } from "@forgecy/core/testing/archives";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { chunkPages, orderPages, pagePriority } from "../src/import/analyst";
import { colorName, keepBestSingleValues, type CandidateProposal } from "../src/import/candidates";
import { detectImportFile } from "../src/import/detect";
import { extractFile } from "../src/import/extract";
import { familyFromFileName, readFontNames, weightFromName } from "../src/import/fonts";

const THEME = `<a:theme><a:themeElements><a:clrScheme name="Rossi">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:accent1><a:srgbClr val="0044CC"/></a:accent1>
</a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Playfair Display"/></a:majorFont>
<a:minorFont><a:latin typeface="Inter"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

const docx = () =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<w:document><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>About us</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Roasting since 1950, </w:t></w:r><w:r><w:t>Milan &amp; Turin.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Colors</w:t></w:r></w:p>
<w:p><w:r><w:t>Rossi Blue #0044CC</w:t></w:r></w:p>
</w:body></w:document>`,
    ),
    "word/theme/theme1.xml": strToU8(THEME),
  });

const pptx = () =>
  zipSync({
    "ppt/presentation.xml": strToU8("<p:presentation/>"),
    "ppt/slides/slide2.xml": strToU8(
      "<p:sld><a:p><a:r><a:t>Tone of voice</a:t></a:r></a:p></p:sld>",
    ),
    "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:r><a:t>Brand book</a:t></a:r></a:p></p:sld>"),
    "ppt/theme/theme1.xml": strToU8(THEME),
  });

/** A minimal TrueType file with only a name table (family 1, subfamily 2), Windows UTF-16BE. */
function ttf(family: string, subfamily: string): Uint8Array {
  const enc = (s: string) => {
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) out[i * 2 + 1] = s.charCodeAt(i);
    return out;
  };
  const strings = [enc(family), enc(subfamily)];
  const nameLen = 6 + strings.length * 12 + strings.reduce((n, s) => n + s.length, 0);
  const buf = new Uint8Array(12 + 16 + nameLen);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  buf.set(strToU8("name"), 12);
  v.setUint32(20, 28);
  v.setUint32(24, nameLen);
  const t = 28;
  v.setUint16(t + 2, strings.length);
  v.setUint16(t + 4, 6 + strings.length * 12);
  let off = 0;
  strings.forEach((s, i) => {
    const r = t + 6 + i * 12;
    v.setUint16(r, 3);
    v.setUint16(r + 2, 1);
    v.setUint16(r + 4, 0x409);
    v.setUint16(r + 6, i + 1);
    v.setUint16(r + 8, s.length);
    v.setUint16(r + 10, off);
    buf.set(s, t + 6 + strings.length * 12 + off);
    off += s.length;
  });
  return buf;
}

describe("detectImportFile", () => {
  it("recognizes OOXML from the bytes, not the name", async () => {
    expect(await detectImportFile({ name: "book.zip", mime: "", bytes: docx() })).toMatchObject({
      ok: true,
      type: "docx",
    });
    expect(await detectImportFile({ name: "deck.docx", mime: "", bytes: pptx() })).toMatchObject({
      ok: true,
      type: "pptx",
    });
    const other = zipSync({ "a.txt": strToU8("x") });
    expect(
      (await detectImportFile({ name: "a.zip", mime: "application/zip", bytes: other })).ok,
    ).toBe(false);
  });

  it("accepts PDF, text and WOFF and refuses empty or unknown files", async () => {
    expect(
      await detectImportFile({
        name: "b.pdf",
        mime: "application/pdf",
        bytes: strToU8("%PDF-1.7\n..."),
      }),
    ).toMatchObject({
      ok: true,
      type: "pdf",
    });
    expect(
      await detectImportFile({ name: "note.md", mime: "", bytes: strToU8("# Tono\nCaldo") }),
    ).toMatchObject({
      ok: true,
      type: "text",
    });
    expect(
      await detectImportFile({ name: "f.woff", mime: "", bytes: strToU8("wOFF....") }),
    ).toMatchObject({
      ok: true,
      type: "font",
    });
    expect(await detectImportFile({ name: "x.pdf", mime: "", bytes: new Uint8Array() })).toEqual({
      ok: false,
      message: "The file is empty.",
      ref: { key: "brand.errors.fileEmpty" },
    });
    expect(
      (
        await detectImportFile({
          name: "x.exe",
          mime: "application/octet-stream",
          bytes: strToU8("MZ\x90\x00"),
        })
      ).ok,
    ).toBe(false);
  });
});

describe("extractFile", () => {
  it("splits a DOCX by headings and reads theme colors and fonts", async () => {
    const r = await extractFile("docx", docx(), "book.docx");
    expect(r.pages.map((p) => p.locator)).toEqual(["Section 1: About us", "Section 2: Colors"]);
    expect(r.pages[0]!.text).toContain("Roasting since 1950, Milan & Turin.");
    expect(r.colors.map((c) => c.hex)).toContain("#0044CC");
    expect(r.fonts).toEqual([
      { family: "Playfair Display", role: "display", weights: [], locator: "Document theme" },
      { family: "Inter", role: "body", weights: [], locator: "Document theme" },
    ]);
  });

  it("orders PPTX slides by number", async () => {
    const r = await extractFile("pptx", pptx(), "deck.pptx");
    expect(r.pages).toEqual([
      { locator: "Slide 1", text: "Brand book" },
      { locator: "Slide 2", text: "Tone of voice" },
    ]);
  });

  it("reads SVG colors and markdown sections", async () => {
    const svg = await extractFile(
      "svg",
      strToU8('<svg><path fill="#f00"/><path fill="#F00"/></svg>'),
      "logo.svg",
    );
    expect(svg.colors[0]).toMatchObject({ hex: "#FF0000", count: 2 });
    const md = await extractFile("text", strToU8("Intro\n# Values\nHonesty"), "note.md");
    expect(md.pages.map((p) => p.locator)).toEqual(["Start", "Section: Values"]);
  });

  it("names fonts from the name table, else from the file name", async () => {
    expect(readFontNames(ttf("Rossi Sans", "Bold"))).toEqual({
      family: "Rossi Sans",
      subfamily: "Bold",
    });
    const r = await extractFile("font", ttf("Rossi Sans", "Bold"), "x.ttf");
    expect(r.fonts[0]).toMatchObject({ family: "Rossi Sans", weights: [700] });
    expect(familyFromFileName("RossiSerif-SemiBoldItalic.woff2")).toBe("Rossi Serif");
    expect(weightFromName("Light")).toBe(300);
  });
});

describe("chunkPages", () => {
  it("keeps pages whole and respects the budget", () => {
    const pages = [1, 2, 3].map((n) => ({ locator: `p. ${n}`, text: "x".repeat(40) }));
    expect(chunkPages(pages, 120).map((c) => c.length)).toEqual([2, 1]);
  });

  it("never leaves a lone small page in the last request: the last two are balanced", () => {
    // The deodue run: 15 pages of ~4,200 characters with a 60,000 budget went 14 + 1.
    const pages = Array.from({ length: 15 }, (_, n) => ({
      locator: `/p${n}`,
      text: "x".repeat(4200),
    }));
    const chunks = chunkPages(pages, 60_000);
    expect(chunks.map((c) => c.length)).toEqual([8, 7]);
    expect(chunks.flat().map((p) => p.locator)).toEqual(pages.map((p) => p.locator));
    const size = (c: typeof pages) =>
      c.reduce((n, p) => n + p.text.length + p.locator.length + 8, 0);
    expect(chunks.every((c) => size(c) <= 60_000)).toBe(true);
  });
});

describe("orderPages", () => {
  it("puts the home page, then the about pages, first; the rest keeps its order", () => {
    const order = orderPages(
      ["/prodotti/a/", "/contatti/", "/azienda/", "/", "/prodotti/", "/chi-siamo/storia"].map(
        (locator) => ({ locator }),
      ),
    ).map((p) => p.locator);
    expect(order).toEqual([
      "/",
      "/azienda/",
      "/chi-siamo/storia",
      "/prodotti/a/",
      "/contatti/",
      "/prodotti/",
    ]);
    expect(pagePriority("p. 3")).toBe(2);
  });
});

describe("keepBestSingleValues", () => {
  const set = (path: string, value: string, chunk: number, conf: number, locator = "/x") =>
    ({
      path,
      op: "set",
      value,
      modelConfidence: conf,
      chunk,
      evidence: { locator, quote: value },
    }) as CandidateProposal;

  it("keeps one value per single-value field: first request, then confidence, then home/about", () => {
    const home = set("/document/strategy/oneLiner", "Home", 0, 0.6, "/");
    const product = set("/document/strategy/oneLiner", "Product", 1, 0.99, "/prodotti/a/");
    const surer = set("/document/strategy/positioning", "Surer", 0, 0.9, "/prodotti/a/");
    const lessSure = set("/document/strategy/positioning", "Less", 0, 0.5, "/");
    const about = set("/document/verbal/voice", "About", 0, 0.7, "/azienda/");
    const other = set("/document/verbal/voice", "Other", 0, 0.7, "/contatti/");
    const value = {
      path: "/document/strategy/values",
      op: "append",
      value: { name: "Cura" },
      evidence: {},
    } as CandidateProposal;
    const value2 = { ...value, value: { name: "Qualità" }, chunk: 1 } as CandidateProposal;
    const color = {
      kind: "color",
      path: "",
      op: "set",
      value: {},
      evidence: {},
    } as CandidateProposal;
    expect(
      keepBestSingleValues([product, home, lessSure, surer, other, about, value, value2, color]),
    ).toEqual([home, surer, about, value, value2, color]);
  });
});

describe("colorName", () => {
  it("takes the words right before the value", () => {
    const ctx = "Colors Rossi Blue #0044CC used for headings. Cream #F5EBDC for backgrounds.";
    expect(colorName(ctx, "#F5EBDC", "x")).toBe("Cream");
    expect(colorName(ctx, "#0044CC", "x")).toBe("Colors Rossi Blue");
    expect(colorName("White: #fff", "#FFFFFF", "x")).toBe("White");
    expect(colorName("#123456", "#123456", "color-1")).toBe("color-1");
    // The first import loads the db and service modules, slow on a busy CI runner.
  }, 30_000);
});

// Multi-MB buffers: generous timeout for a loaded parallel run.
describe("hostile imports", { timeout: 30_000 }, () => {
  const key = (err: unknown) => (err as { ref: { key: string } }).ref.key;

  it("refuses an Office file that inflates far beyond its limits", async () => {
    const bomb = zipArchive([{ name: "word/document.xml", data: Buffer.alloc(60 * 1024 * 1024) }]);
    const err = await extractFile("docx", bomb, "bomb.docx").catch((e) => e);
    expect(key(err)).toBe("brand.import.errors.archiveTooLarge");
  });
  it("refuses an Office file whose parts add up past the total limit", async () => {
    const part = (n: number) => ({
      name: `ppt/slides/slide${n}.xml`,
      data: Buffer.alloc(40 * 1024 * 1024),
    });
    const err = await extractFile(
      "pptx",
      zipArchive([part(1), part(2), part(3)]),
      "sum.pptx",
    ).catch((e) => e);
    expect(key(err)).toBe("brand.import.errors.archiveTooLarge");
  });
  it("refuses an Office file with thousands of entries", async () => {
    const entries = Array.from({ length: 10_001 }, (_, i) => ({
      name: `junk/${i}.txt`,
      data: "x",
    }));
    const zip = zipArchive([{ name: "word/document.xml", data: "<w:document/>" }, ...entries]);
    const err = await extractFile("docx", zip, "many.docx").catch((e) => e);
    expect(key(err)).toBe("brand.import.errors.archiveTooLarge");
  });
  it("refuses an entry whose real size differs from the size it declares", async () => {
    const lying = zipArchive([
      { name: "word/document.xml", data: Buffer.alloc(40 * 1024 * 1024), declaredSize: 1000 },
    ]);
    const err = await extractFile("docx", lying, "lie.docx").catch((e) => e);
    expect(key(err)).toBe("brand.import.errors.damaged");
  });
  it("bounds stored entries that overlap and declare no size, by the bytes really read", async () => {
    const zip = overlappingZip({
      data: Buffer.alloc(1024 * 1024, 0x41),
      entries: 300,
      store: true,
      declaredSize: 0,
      name: (i) => `ppt/slides/slide${i}.xml`,
    });
    const err = await extractFile("pptx", zip, "overlap.pptx").catch((e) => e);
    expect(key(err)).toBe("brand.import.errors.damaged");
    // Same, when the sizes agree: only the real-byte budget can stop it (300 MiB asked, 100 MiB cap).
    const honest = overlappingZip({
      data: Buffer.alloc(1024 * 1024, 0x41),
      entries: 300,
      store: true,
      declaredSize: 1024 * 1024,
      name: (i) => `ppt/slides/slide${i}.xml`,
    });
    const err2 = await extractFile("pptx", honest, "overlap2.pptx").catch((e) => e);
    expect(key(err2)).toBe("brand.import.errors.archiveTooLarge");
  });
  it("stops an overlapping deflate bomb early instead of inflating it once per entry", async () => {
    const zip = overlappingZip({
      data: Buffer.alloc(64 * 1024 * 1024),
      entries: 20,
      declaredSize: 1,
      name: (i) => `ppt/slides/slide${i}.xml`,
    });
    const t = Date.now();
    const err = await extractFile("pptx", zip, "cpu.pptx").catch((e) => e);
    expect(Date.now() - t).toBeLessThan(10_000);
    expect(key(err)).toBe("brand.import.errors.damaged");
  });
  it("stops an honest overlapping deflate bomb at the byte budget", async () => {
    const zip = overlappingZip({
      data: Buffer.alloc(64 * 1024 * 1024),
      entries: 20,
      declaredSize: 64 * 1024 * 1024,
      name: (i) => `ppt/slides/slide${i}.xml`,
    });
    const t = Date.now();
    const err = await extractFile("pptx", zip, "cpu2.pptx").catch((e) => e);
    expect(Date.now() - t).toBeLessThan(10_000);
    expect(key(err)).toBe("brand.import.errors.archiveTooLarge");
  });
  it("applies the same limits in the type detection that runs before extraction", async () => {
    const t = Date.now();
    const overlap = overlappingZip({
      data: Buffer.alloc(1024),
      entries: 12_000,
      store: true,
      declaredSize: 1024,
      name: (i) => (i === 1 ? "word/document.xml" : `junk/${i}.xml`),
    });
    const r = await detectImportFile({ name: "x.docx", mime: "", bytes: overlap });
    expect(r).toMatchObject({ ok: false, ref: { key: "brand.import.errors.archiveTooLarge" } });
    expect(Date.now() - t).toBeLessThan(10_000);
  });
  it("still detects a normal document through the guarded path", async () => {
    expect(await detectImportFile({ name: "ok.docx", mime: "", bytes: docx() })).toMatchObject({
      ok: true,
      type: "docx",
    });
  });
  it("never inflates parts it does not read, however big (a media-heavy deck stays legit)", async () => {
    const deck = zipArchive([
      {
        name: "ppt/slides/slide1.xml",
        data: "<p:sld><a:p><a:r><a:t>Brand book</a:t></a:r></a:p></p:sld>",
      },
      { name: "ppt/media/huge.bin", data: Buffer.alloc(120 * 1024 * 1024) },
    ]);
    const out = await extractFile("pptx", deck, "media.pptx");
    expect(out.pages.map((p) => p.text)).toEqual(["Brand book"]);
  });
  it("accepts a 50 MB deck with thousands of media entries and small text parts", async () => {
    const media = Array.from({ length: 4_000 }, (_, i) => ({
      name: `ppt/media/image${i}.png`,
      data: Buffer.alloc(12 * 1024, i % 251),
      store: true,
    }));
    const deck = zipArchive([
      { name: "ppt/presentation.xml", data: "<p:presentation/>" },
      {
        name: "ppt/slides/slide1.xml",
        data: "<p:sld><a:p><a:r><a:t>Brand book</a:t></a:r></a:p></p:sld>",
      },
      ...media,
    ]);
    expect(deck.length).toBeGreaterThan(45 * 1024 * 1024);
    expect(await detectImportFile({ name: "deck.pptx", mime: "", bytes: deck })).toMatchObject({
      ok: true,
      type: "pptx",
    });
    const out = await extractFile("pptx", deck, "deck.pptx");
    expect(out.pages.map((p) => p.text)).toEqual(["Brand book"]);
  });
  it("still reads a normal document", async () => {
    const out = await extractFile("docx", docx(), "ok.docx");
    expect(out.pages.length).toBeGreaterThan(0);
  });
  it("refuses a PDF with an absurd page count before reading any page", async () => {
    const err = await extractFile("pdf", pdfWithPages(2_500), "pages.pdf").catch((e) => e);
    expect(key(err)).toBe("brand.import.errors.pdfTooManyPages");
  });
  it("reads only the first pages of a long PDF and says so", async () => {
    const out = await extractFile("pdf", pdfWithPages(450), "long.pdf");
    expect(out.warnings.map((w) => w.key)).toContain("brand.import.warnings.firstPages");
  });
});
