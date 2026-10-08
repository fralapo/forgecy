/**
 * Deterministic extraction from imported files: page texts with their locator
 * (page, slide or section), colors and fonts. No AI here; the Brand Analyst step
 * reads the pages afterwards.
 */
import type { MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import { unzipSync, strFromU8 } from "fflate";
import { normalizeHex } from "../tokens";
import type { ImportFileType } from "./detect";
import { familyFromFileName, readFontNames, weightFromName } from "./fonts";

export interface ExtractedPage {
  /**
   * Where the text is ("p. 12", "Slide 3"): a stable English id that the AI cites back;
   * the interface translates it when shown.
   */
  locator: string;
  text: string;
}

export interface ExtractedColor {
  hex: string;
  locator: string;
  /** Words around the value, used to name the color ("Rossi Blue #0044CC"). */
  context: string;
  count: number;
}

export interface ExtractedFont {
  family: string;
  role?: "display" | "body";
  weights: number[];
  locator: string;
}

export interface Extraction {
  pages: ExtractedPage[];
  colors: ExtractedColor[];
  fonts: ExtractedFont[];
  /** Set when part of the file could not be read. */
  warnings: MessageRef[];
}

type ImportKey<G extends string> = MessageKey & `brand.import.${G}.${string}`;

/** `message` is English (logs); `ref` is the same text for the interface. */
export class ExtractionError extends Error {
  readonly ref: MessageRef;
  constructor(key: ImportKey<"errors">) {
    super(englishMessage(key));
    this.name = "ExtractionError";
    this.ref = messageRef(key);
  }
}

const warning = (key: ImportKey<"warnings">, values?: MessageValues) => messageRef(key, values);

const MAX_PAGES = 400;
const MAX_PDF_PAGES = 2_000; // above this the PDF is refused; below it only MAX_PAGES are read
const MAX_PAGE_CHARS = 20_000;
// Office files come from uploads capped at 50 MB (UPLOAD_LIMITS.document in @forgecy/files), so a
// real deck with many images can hold thousands of entries; only the text parts are ever inflated.
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 100 * 1024 * 1024;
/** The only parts of a DOCX/PPTX this file reads; everything else is never inflated. */
const OOXML_PARTS =
  /^(?:word\/document\.xml|word\/theme\/[^/]+\.xml|ppt\/slides\/slide\d+\.xml|ppt\/theme\/[^/]+\.xml)$/;

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

const clean = (s: string) =>
  s
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// ---- Colors ----

const HEX_RE = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi;
const RGB_RE = /\brgb\s*\(?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?/gi;

function addColor(
  map: Map<string, ExtractedColor>,
  hex: string | null,
  locator: string,
  context: string,
) {
  if (!hex) return;
  const found = map.get(hex);
  if (found) found.count++;
  else
    map.set(hex, {
      hex,
      locator,
      context: context.replace(/\s+/g, " ").trim().slice(0, 120),
      count: 1,
    });
}

export function colorsInText(pages: readonly ExtractedPage[]): ExtractedColor[] {
  const map = new Map<string, ExtractedColor>();
  for (const page of pages) {
    for (const m of page.text.matchAll(HEX_RE)) {
      const i = m.index ?? 0;
      addColor(
        map,
        normalizeHex(m[0]),
        page.locator,
        page.text.slice(Math.max(0, i - 50), i + m[0].length + 20),
      );
    }
    for (const m of page.text.matchAll(RGB_RE)) {
      const [r, g, b] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
      if ([r, g, b].some((c) => c > 255)) continue;
      const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
      const i = m.index ?? 0;
      addColor(
        map,
        normalizeHex(hex),
        page.locator,
        page.text.slice(Math.max(0, i - 50), i + m[0].length + 20),
      );
    }
  }
  return [...map.values()];
}

// ---- Office Open XML ----

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let entries = 0;
  let total = 0;
  try {
    return unzipSync(bytes, {
      // Runs on the central directory before anything is inflated. fflate inflates into a buffer
      // of the declared size and truncates there (a lying zip just yields fewer bytes), so the
      // declared figures are a real upper bound on memory.
      filter: (file) => {
        if (++entries > MAX_ZIP_ENTRIES)
          throw new ExtractionError("brand.import.errors.archiveTooLarge");
        if (!OOXML_PARTS.test(file.name)) return false;
        total += file.originalSize;
        if (file.originalSize > MAX_ZIP_ENTRY_BYTES || total > MAX_ZIP_TOTAL_BYTES)
          throw new ExtractionError("brand.import.errors.archiveTooLarge");
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError("brand.import.errors.damaged");
  }
}

function themeOf(files: Record<string, Uint8Array>, prefix: "word" | "ppt") {
  const name = Object.keys(files).find(
    (n) => n.startsWith(`${prefix}/theme/`) && n.endsWith(".xml"),
  );
  if (!name) return { colors: [] as ExtractedColor[], fonts: [] as ExtractedFont[] };
  const xml = strFromU8(files[name]!);
  const colors: ExtractedColor[] = [];
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] ?? "";
  for (const m of scheme.matchAll(
    /<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>[\s\S]*?(?:srgbClr val|lastClr)="([0-9A-Fa-f]{6})"/g,
  )) {
    const hex = normalizeHex(m[2]!);
    if (hex)
      colors.push({
        hex,
        locator: "Document theme",
        context: `Theme color ${m[1]}`,
        count: 1,
      });
  }
  const fonts: ExtractedFont[] = [];
  const major = /<a:majorFont>[\s\S]*?<a:latin typeface="([^"]+)"/.exec(xml)?.[1];
  const minor = /<a:minorFont>[\s\S]*?<a:latin typeface="([^"]+)"/.exec(xml)?.[1];
  if (major)
    fonts.push({
      family: decodeXml(major),
      role: "display",
      weights: [],
      locator: "Document theme",
    });
  if (minor && minor !== major)
    fonts.push({
      family: decodeXml(minor),
      role: "body",
      weights: [],
      locator: "Document theme",
    });
  return { colors, fonts };
}

function paragraphs(
  xml: string,
  textTag: "w:t" | "a:t",
): Array<{ text: string; heading: boolean }> {
  const out: Array<{ text: string; heading: boolean }> = [];
  const para = textTag === "w:t" ? /<w:p[ >][\s\S]*?<\/w:p>/g : /<a:p>[\s\S]*?<\/a:p>/g;
  const run = textTag === "w:t" ? /<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g : /<a:t>([\s\S]*?)<\/a:t>/g;
  for (const p of xml.match(para) ?? []) {
    const text = [...p.matchAll(run)].map((m) => decodeXml(m[1]!)).join("");
    if (!text.trim()) continue;
    // "Titolo" is the Italian Word heading style name.
    const heading = textTag === "w:t" && /<w:pStyle w:val="(Heading|Titolo|Title)[^"]*"/i.test(p);
    out.push({ text, heading });
  }
  return out;
}

function extractDocx(bytes: Uint8Array): Extraction {
  const files = unzip(bytes);
  const doc = files["word/document.xml"];
  if (!doc) throw new ExtractionError("brand.import.errors.wordEmpty");
  const pages: ExtractedPage[] = [];
  let current: ExtractedPage = { locator: "Start of document", text: "" };
  let section = 0;
  for (const p of paragraphs(strFromU8(doc), "w:t")) {
    if (p.heading && current.text.trim()) {
      pages.push(current);
      section++;
      current = { locator: `Section ${section + 1}: ${p.text.slice(0, 60)}`, text: "" };
    } else if (p.heading) current.locator = `Section ${section + 1}: ${p.text.slice(0, 60)}`;
    current.text += `${p.text}\n`;
  }
  if (current.text.trim()) pages.push(current);
  const theme = themeOf(files, "word");
  const cleaned = pages.map((pg) => ({
    locator: pg.locator,
    text: clean(pg.text).slice(0, MAX_PAGE_CHARS),
  }));
  return {
    pages: cleaned,
    colors: [...theme.colors, ...colorsInText(cleaned)],
    fonts: theme.fonts,
    warnings: [],
  };
}

function extractPptx(bytes: Uint8Array): Extraction {
  const files = unzip(bytes);
  const slides = Object.keys(files)
    .map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ n: Number(m[1]), name: m[0] }))
    .sort((a, b) => a.n - b.n);
  const pages: ExtractedPage[] = [];
  const used = new Map<string, ExtractedColor>();
  for (const s of slides.slice(0, MAX_PAGES)) {
    const xml = strFromU8(files[s.name]!);
    const text = paragraphs(xml, "a:t")
      .map((p) => p.text)
      .join("\n");
    const locator = `Slide ${s.n}`;
    if (text.trim()) pages.push({ locator, text: clean(text).slice(0, MAX_PAGE_CHARS) });
    for (const m of xml.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"/g))
      addColor(used, normalizeHex(m[1]!), locator, "Color used in the slides");
  }
  const theme = themeOf(files, "ppt");
  const themeHex = new Set(theme.colors.map((c) => c.hex));
  const frequent = [...used.values()].filter((c) => !themeHex.has(c.hex) && c.count >= 3);
  const warnings =
    slides.length > MAX_PAGES
      ? [warning("brand.import.warnings.firstSlides", { max: MAX_PAGES })]
      : [];
  return {
    pages,
    colors: [...theme.colors, ...frequent, ...colorsInText(pages)],
    fonts: theme.fonts,
    warnings,
  };
}

// ---- PDF ----

async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    const name = (err as { name?: string }).name ?? "";
    if (/password/i.test(name) || /password/i.test(String((err as Error).message)))
      throw new ExtractionError("brand.import.errors.pdfProtected");
    throw new ExtractionError("brand.import.errors.pdfDamaged");
  }
  try {
    const totalPages = pdf.numPages;
    // Checked before any page is touched: unpdf's extractText would start all of them at once.
    if (totalPages > MAX_PDF_PAGES) throw new ExtractionError("brand.import.errors.pdfTooManyPages");
    const pages: ExtractedPage[] = [];
    try {
      for (let n = 1; n <= Math.min(totalPages, MAX_PAGES); n++) {
        const content = await (await pdf.getPage(n)).getTextContent();
        // Trimmed per page as it is read, so the text kept never exceeds MAX_PAGES * MAX_PAGE_CHARS.
        const text = clean(
          content.items
            .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : ""))
            .join(""),
        ).slice(0, MAX_PAGE_CHARS);
        if (text) pages.push({ locator: `p. ${n}`, text });
      }
    } catch {
      throw new ExtractionError("brand.import.errors.pdfDamaged");
    }
    const warnings: MessageRef[] = [];
    if (totalPages > MAX_PAGES)
      warnings.push(warning("brand.import.warnings.firstPages", { max: MAX_PAGES }));
    if (totalPages > 0 && pages.length === 0)
      warnings.push(warning("brand.import.warnings.pdfNoText"));
    return { pages, colors: colorsInText(pages), fonts: [], warnings };
  } finally {
    await pdf.cleanup?.();
  }
}

// ---- SVG, fonts, text ----

function extractSvg(bytes: Uint8Array): Extraction {
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const map = new Map<string, ExtractedColor>();
  for (const m of xml.matchAll(
    /(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,6})\b/g,
  ))
    addColor(map, normalizeHex(m[1]!), "SVG file", "Color used in the drawing");
  const text = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => decodeXml(m[1]!.replace(/<[^>]+>/g, "")))
    .join("\n");
  return {
    pages: text.trim() ? [{ locator: "SVG file", text: clean(text) }] : [],
    colors: [...map.values()].sort((a, b) => b.count - a.count),
    fonts: [],
    warnings: [],
  };
}

function extractFont(bytes: Uint8Array, fileName: string): Extraction {
  const names = readFontNames(bytes);
  const family = names?.family ?? familyFromFileName(fileName);
  const weight = weightFromName(names?.subfamily) ?? weightFromName(fileName);
  return {
    pages: [],
    colors: [],
    fonts: [{ family, weights: weight ? [weight] : [], locator: fileName }],
    warnings: names ? [] : [warning("brand.import.warnings.fontFromFileName")],
  };
}

function extractText(bytes: Uint8Array): Extraction {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const pages: ExtractedPage[] = [];
  let current: ExtractedPage = { locator: "Start", text: "" };
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) {
      if (current.text.trim()) pages.push(current);
      current = { locator: `Section: ${h[1]!.slice(0, 60)}`, text: "" };
    }
    current.text += `${line}\n`;
  }
  if (current.text.trim()) pages.push(current);
  const cleaned = pages
    .slice(0, MAX_PAGES)
    .map((p) => ({ locator: p.locator, text: clean(p.text).slice(0, MAX_PAGE_CHARS) }));
  return { pages: cleaned, colors: colorsInText(cleaned), fonts: [], warnings: [] };
}

/** Pages, colors and fonts of one imported file. Throws ExtractionError with a user-facing message. */
export async function extractFile(
  type: ImportFileType,
  bytes: Uint8Array,
  fileName: string,
): Promise<Extraction> {
  switch (type) {
    case "pdf":
      return extractPdf(bytes);
    case "docx":
      return extractDocx(bytes);
    case "pptx":
      return extractPptx(bytes);
    case "svg":
      return extractSvg(bytes);
    case "font":
      return extractFont(bytes, fileName);
    case "text":
      return extractText(bytes);
    case "image":
      return { pages: [], colors: [], fonts: [], warnings: [] };
  }
}
