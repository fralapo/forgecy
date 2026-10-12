import { parse } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import { importError } from "../import/errors";
import { IMPORT_LIMITS } from "../import/limits";
import { assertSafeOfficeFile } from "./zip";

export interface SheetData {
  headers: string[];
  /** Data rows (header excluded), each with one string per header. */
  rows: string[][];
  encoding?: "utf-8" | "windows-1252";
  delimiter?: string;
}

export interface CsvOptions {
  encoding?: "utf-8" | "windows-1252";
  delimiter?: string;
}

/**
 * Decode CSV bytes: UTF-8 (with or without BOM) first, then Windows-1252, the usual
 * encoding of Excel exports in Italy. Fails with IMPORT-CSV-ENCODING otherwise.
 */
export function decodeCsv(
  data: Uint8Array,
  forced?: CsvOptions["encoding"],
): { text: string; encoding: "utf-8" | "windows-1252" } {
  if (forced) return { text: new TextDecoder(forced).decode(data), encoding: forced };
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data);
    return { text, encoding: "utf-8" };
  } catch {
    const text = new TextDecoder("windows-1252").decode(data);
    // Control characters other than tab/newline mean it is not a text file at all.
    // eslint-disable-next-line no-control-regex -- detecting binary content
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 4096)))
      throw importError("IMPORT-CSV-ENCODING", "products.errors.csvEncoding");
    return { text, encoding: "windows-1252" };
  }
}

/** Pick the delimiter that splits the first lines most consistently. */
export function sniffDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 10);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (!q && ch === d) n++;
  }
  return n;
}

function finalize(table: unknown[][], name: string): SheetData {
  const nonEmpty = table.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const [head, ...body] = nonEmpty;
  if (!head) throw importError("IMPORT-INVALID", "products.errors.sheetNoRows", { name });
  if (body.length > IMPORT_LIMITS.sheetRows)
    throw importError("IMPORT-TOO-LARGE", "products.errors.tooManyRows", {
      name,
      rows: body.length,
      max: IMPORT_LIMITS.sheetRows,
    });
  const headers = head.map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
  const width = headers.length;
  const rows = body.map((r) => Array.from({ length: width }, (_, i) => cellToString(r[i])));
  return { headers, rows };
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

export function parseCsv(data: Uint8Array, name: string, opts: CsvOptions = {}): SheetData {
  const { text, encoding } = decodeCsv(data, opts.encoding);
  const delimiter = opts.delimiter ?? sniffDelimiter(text);
  let table: string[][];
  try {
    table = parse(text, {
      delimiter,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      max_record_size: 1_000_000,
      to: IMPORT_LIMITS.sheetRows + 2,
    }) as string[][];
  } catch {
    throw importError("IMPORT-CSV-ENCODING", "products.errors.csvDelimiter", { name });
  }
  if (table.length > IMPORT_LIMITS.sheetRows + 1) {
    // `to` stops early: count the real number of lines for the message.
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
    throw importError("IMPORT-TOO-LARGE", "products.errors.tooManyRows", {
      name,
      rows: lines,
      max: IMPORT_LIMITS.sheetRows,
    });
  }
  const sheet = finalize(table, name);
  if (sheet.headers.length < 2 && delimiter === ",")
    throw importError("IMPORT-CSV-ENCODING", "products.errors.csvDelimiter", { name });
  return { ...sheet, encoding, delimiter };
}

/** First worksheet of an XLSX file, after the zip-bomb guard. */
export async function parseXlsx(data: Buffer, name: string): Promise<SheetData> {
  await assertSafeOfficeFile(data, name);
  let table: unknown[][];
  try {
    table = (await readSheet(data)) as unknown[][];
  } catch {
    throw importError("IMPORT-INVALID", "products.errors.xlsxUnreadable", { name });
  }
  return finalize(table, name);
}

export async function parseSheet(
  data: Buffer,
  name: string,
  format: "csv" | "xlsx",
  opts: CsvOptions = {},
): Promise<SheetData> {
  return format === "csv" ? parseCsv(data, name, opts) : parseXlsx(data, name);
}
