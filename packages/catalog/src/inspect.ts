import type { ConfidenceLevel } from "@forgecy/core";
import { readTextDocument } from "./documents";
import { isImportError, type ImportErrorCode } from "./errors";
import { IMPORT_LIMITS } from "./limits";
import { isWooCommerceExport, suggestMapping, type ColumnMapping } from "./mapping";
import { readPdfText } from "./pdf";
import { parseSheet, type CsvOptions } from "./sheet";
import { sniffFile, type SniffedFormat } from "./sniff";
import { readZip } from "./zip";

export interface FileMeta {
  rows?: number;
  headers?: string[];
  sample?: string[][];
  encoding?: string;
  delimiter?: string;
  woocommerce?: boolean;
  pages?: number;
  chars?: number;
  textless?: boolean;
  archive?: {
    entries: number;
    sheets: number;
    images: number;
    pdfs: number;
    texts: number;
    ignored: number;
    pdfBytes: number;
  };
  /** Manual CSV options chosen after IMPORT-CSV-ENCODING. */
  csv?: CsvOptions;
}

export interface Inspection {
  valid: boolean;
  meta: FileMeta;
  code?: ImportErrorCode;
  message?: string;
  /** Short validation text shown in the list ("Valido · 412 righe"). */
  summary: string;
}

export interface MappingProposalData extends ColumnMapping {
  confidence: ConfidenceLevel[];
  savedName?: string;
}

const fmt = (n: number) => n.toLocaleString("it-IT");

/**
 * Validate and read the useful facts of one file: rows and headers of a sheet,
 * pages and text of a PDF, content of a ZIP (central directory only).
 */
export async function inspectFile(
  format: SniffedFormat,
  name: string,
  source: { data?: Buffer; path?: string },
  csv?: CsvOptions,
): Promise<Inspection> {
  try {
    switch (format) {
      case "csv":
      case "xlsx": {
        const sheet = await parseSheet(source.data!, name, format, csv);
        return {
          valid: true,
          meta: {
            rows: sheet.rows.length,
            headers: sheet.headers,
            sample: sheet.rows.slice(0, 5).map((r) => r.map((c) => c.slice(0, 300))),
            ...(sheet.encoding ? { encoding: sheet.encoding } : {}),
            ...(sheet.delimiter ? { delimiter: sheet.delimiter } : {}),
            woocommerce: isWooCommerceExport(sheet.headers),
            ...(csv ? { csv } : {}),
          },
          summary: `Valido · ${fmt(sheet.rows.length)} righe`,
        };
      }
      case "pdf": {
        const pdf = await readPdfText(source.data!, name);
        const chars = pdf.pages.reduce((n, p) => n + p.length, 0);
        return {
          valid: true,
          meta: { pages: pdf.totalPages, chars, textless: pdf.textless },
          summary: pdf.textless
            ? `${fmt(pdf.totalPages)} pagine · senza testo leggibile (solo come fonte)`
            : `Valido · ${fmt(pdf.totalPages)} pagine`,
        };
      }
      case "zip": {
        const counts = {
          entries: 0,
          sheets: 0,
          images: 0,
          pdfs: 0,
          texts: 0,
          ignored: 0,
          pdfBytes: 0,
        };
        const listing = await readZip(source.path ?? source.data!, { label: name });
        for (const e of listing.entries) {
          counts.entries++;
          const s = sniffByName(e.path);
          if (s === "sheet") counts.sheets++;
          else if (s === "image") counts.images++;
          else if (s === "pdf") {
            counts.pdfs++;
            counts.pdfBytes += e.uncompressedSize;
          } else if (s === "text") counts.texts++;
          else counts.ignored++;
        }
        counts.ignored += listing.skipped;
        const parts = [
          counts.sheets ? `${fmt(counts.sheets)} fogli` : "",
          counts.images ? `${fmt(counts.images)} immagini` : "",
          counts.pdfs ? `${fmt(counts.pdfs)} PDF` : "",
          counts.texts ? `${fmt(counts.texts)} testi` : "",
        ].filter(Boolean);
        return {
          valid: counts.entries - counts.ignored + listing.skipped > 0,
          meta: { archive: counts },
          summary: `ZIP: ${parts.join(", ") || "nessun file utile"}${counts.ignored ? ` · ${fmt(counts.ignored)} file ignorati: formati non ammessi` : ""}`,
          ...(counts.entries - counts.ignored + listing.skipped > 0
            ? {}
            : {
                code: "IMPORT-INVALID" as const,
                message: `"${name}" non contiene file utilizzabili.`,
              }),
        };
      }
      case "txt":
      case "docx": {
        const text = await readTextDocument(source.data!, name, format);
        return { valid: true, meta: { chars: text.length }, summary: "Valido · testo" };
      }
      default:
        return { valid: true, meta: {}, summary: "Valido" };
    }
  } catch (err) {
    if (isImportError(err))
      return {
        valid: false,
        meta: {},
        code: err.code,
        message: err.message,
        summary: "Non valido",
      };
    throw err;
  }
}

/** Kind from the extension only (inside ZIPs, before reading bytes). */
export function sniffByName(p: string): "sheet" | "image" | "pdf" | "text" | null {
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  if (["csv", "tsv", "xlsx"].includes(ext)) return "sheet";
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "docx"].includes(ext)) return "text";
  return null;
}

/** Sniff an entry already in memory (ZIP content), applying the per-kind limits. */
export function sniffEntry(p: string, data: Uint8Array) {
  return sniffFile(p, data.length, data.subarray(0, 4096));
}

/** Heuristic proposal with per-column confidence: presets are High, synonyms Medium. */
export function heuristicProposal(headers: string[]): MappingProposalData {
  const m = suggestMapping(headers);
  return {
    ...m,
    confidence: m.columns.map((c) =>
      c === "ignore" ? "low" : m.preset === "woocommerce" ? "high" : "medium",
    ),
  };
}

export const PDF_TEXT_LIMIT = IMPORT_LIMITS.pdfBytes;
