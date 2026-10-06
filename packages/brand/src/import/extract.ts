/**
 * Deterministic extraction from imported files: page texts with their locator
 * (page, slide or section), colors and fonts. No AI here; the Brand Analyst step
 * reads the pages afterwards.
 */
import { unzipSync, strFromU8 } from "fflate";
import { normalizeHex } from "../tokens";
import type { ImportFileType } from "./detect";
import { familyFromFileName, readFontNames, weightFromName } from "./fonts";

export interface ExtractedPage {
  locator: string;
  text: string;
}

export interface ExtractedColor {
  hex: string;
  locator: string;
  /** Words around the value, used to name the color ("Blu Rossi #0044CC"). */
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
  warnings: string[];
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

const MAX_PAGES = 400;
const MAX_PAGE_CHARS = 20_000;

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
  try {
    return unzipSync(bytes);
  } catch {
    throw new ExtractionError("Non leggibile: il file è danneggiato o protetto da password.");
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
        locator: "Tema del documento",
        context: `Colore del tema ${m[1]}`,
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
      locator: "Tema del documento",
    });
  if (minor && minor !== major)
    fonts.push({
      family: decodeXml(minor),
      role: "body",
      weights: [],
      locator: "Tema del documento",
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
    const heading = textTag === "w:t" && /<w:pStyle w:val="(Heading|Titolo|Title)[^"]*"/i.test(p);
    out.push({ text, heading });
  }
  return out;
}

function extractDocx(bytes: Uint8Array): Extraction {
  const files = unzip(bytes);
  const doc = files["word/document.xml"];
  if (!doc) throw new ExtractionError("Documento Word senza contenuto leggibile.");
  const pages: ExtractedPage[] = [];
  let current: ExtractedPage = { locator: "Inizio del documento", text: "" };
  let section = 0;
  for (const p of paragraphs(strFromU8(doc), "w:t")) {
    if (p.heading && current.text.trim()) {
      pages.push(current);
      section++;
      current = { locator: `Sezione ${section + 1}: ${p.text.slice(0, 60)}`, text: "" };
    } else if (p.heading) current.locator = `Sezione ${section + 1}: ${p.text.slice(0, 60)}`;
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
      addColor(used, normalizeHex(m[1]!), locator, "Colore usato nelle slide");
  }
  const theme = themeOf(files, "ppt");
  const themeHex = new Set(theme.colors.map((c) => c.hex));
  const frequent = [...used.values()].filter((c) => !themeHex.has(c.hex) && c.count >= 3);
  const warnings = slides.length > MAX_PAGES ? [`Lette solo le prime ${MAX_PAGES} slide`] : [];
  return {
    pages,
    colors: [...theme.colors, ...frequent, ...colorsInText(pages)],
    fonts: theme.fonts,
    warnings,
  };
}

// ---- PDF ----

async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    const name = (err as { name?: string }).name ?? "";
    if (/password/i.test(name) || /password/i.test(String((err as Error).message)))
      throw new ExtractionError(
        "Non leggibile: PDF protetto. Caricane una versione senza password.",
      );
    throw new ExtractionError("Non leggibile: il PDF è danneggiato.");
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = text
    .slice(0, MAX_PAGES)
    .map((t, i) => ({ locator: `p. ${i + 1}`, text: clean(t).slice(0, MAX_PAGE_CHARS) }))
    .filter((p) => p.text);
  const warnings: string[] = [];
  if (totalPages > MAX_PAGES) warnings.push(`Lette solo le prime ${MAX_PAGES} pagine`);
  if (totalPages > 0 && pages.length === 0)
    warnings.push(
      "Nessun testo selezionabile: il PDF sembra fatto di immagini. Colori e testi vanno inseriti a mano.",
    );
  await pdf.cleanup?.();
  return { pages, colors: colorsInText(pages), fonts: [], warnings };
}

// ---- SVG, fonts, text ----

function extractSvg(bytes: Uint8Array): Extraction {
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const map = new Map<string, ExtractedColor>();
  for (const m of xml.matchAll(
    /(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,6})\b/g,
  ))
    addColor(map, normalizeHex(m[1]!), "File SVG", "Colore usato nel disegno");
  const text = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => decodeXml(m[1]!.replace(/<[^>]+>/g, "")))
    .join("\n");
  return {
    pages: text.trim() ? [{ locator: "File SVG", text: clean(text) }] : [],
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
    warnings: names ? [] : ["Nome del font ricavato dal nome del file"],
  };
}

function extractText(bytes: Uint8Array): Extraction {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const pages: ExtractedPage[] = [];
  let current: ExtractedPage = { locator: "Inizio", text: "" };
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) {
      if (current.text.trim()) pages.push(current);
      current = { locator: `Sezione: ${h[1]!.slice(0, 60)}`, text: "" };
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
