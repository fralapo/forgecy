import type { SocialPostField } from "@forgecy/core";
import { localizedError } from "@forgecy/i18n";

export interface Table {
  sheets: string[];
  sheet?: string;
  headers: string[];
  rows: string[][];
}

/** Detect the CSV separator from the header line: semicolon (Italian Excel), comma or tab. */
export function detectDelimiter(firstLine: string): "," | ";" | "\t" {
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<"," | ";" | "\t", number>;
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as "," | ";" | "\t"]++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0] as "," | ";" | "\t") ?? ",";
}

/** RFC 4180 CSV with quoted fields, escaped quotes and CRLF; strips a UTF-8 BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  if (text.includes("\uFFFD")) throw localizedError("validation", "audit.errors.fileUnreadable");
  const delimiter = detectDelimiter(text.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Read a CSV or XLSX upload into a header row and data rows (all strings). */
export async function readTable(
  bytes: Uint8Array,
  kind: "csv" | "xlsx",
  sheet?: string,
): Promise<Table> {
  if (kind === "csv") {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const rows = parseCsv(decoded);
    if (rows.length < 2) throw localizedError("validation", "audit.errors.fileNoRows");
    return { sheets: [], headers: rows[0]!.map((h) => h.trim()), rows: rows.slice(1) };
  }
  const { default: readXlsxFile } = await import("read-excel-file/node");
  let sheets: Array<{ sheet: string; data: unknown[][] }>;
  try {
    sheets = (await readXlsxFile(Buffer.from(bytes))) as Array<{
      sheet: string;
      data: unknown[][];
    }>;
  } catch {
    throw localizedError("validation", "audit.errors.xlsxUnreadable");
  }
  const chosen = sheets.find((s) => s.sheet === sheet) ?? sheets[0];
  if (!chosen || chosen.data.length < 2)
    throw localizedError("validation", "audit.errors.sheetNoRows");
  return {
    sheets: sheets.map((s) => s.sheet),
    sheet: chosen.sheet,
    headers: chosen.data[0]!.map(cellToString),
    rows: chosen.data.slice(1).map((r) => r.map(cellToString)),
  };
}

export const dateFormats = ["dd/mm/yyyy", "mm/dd/yyyy", "yyyy-mm-dd"] as const;
export type DateFormat = (typeof dateFormats)[number];

/** Parse a date cell into YYYY-MM-DD, or null. Accepts the chosen format and ISO dates. */
export function parseDateCell(value: string, format: DateFormat): string | null {
  const v = value.trim();
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const parts = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (!parts || format === "yyyy-mm-dd") return null;
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    y = Number(parts[3]);
    if (y < 100) y += 2000;
    [d, m] = format === "dd/mm/yyyy" ? [a, b] : [b, a];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Strict number: "1.234" and "1234" are 1234, "1,5" is 1.5, "12%" is 12. Ranges,
 * approximations and words ("circa 2.000", "1k-2k", "~300") are refused: never estimate.
 */
export function parseStrictNumber(value: string): number | null {
  let v = value.trim().replace(/\s/g, "");
  if (!v) return null;
  if (v.endsWith("%")) v = v.slice(0, -1);
  if (!/^-?[\d.,]+$/.test(v)) return null;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  else if (/^-?\d{1,3}(,\d{3})+$/.test(v)) v = v.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(v)) v = v.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(v)) v = v.replace(",", ".");
  else if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type ColumnMapping = Record<number, SocialPostField | "ignore">;

export interface InterpretedRow {
  rowNumber: number;
  postedOn: string;
  postType?: string;
  format?: string;
  text?: string;
  metrics: Record<string, number>;
}

export interface InterpretResult {
  rows: InterpretedRow[];
  invalid: Array<{ rowNumber: number; reason: string }>;
}

const TEXT_FIELDS = new Set<SocialPostField>(["post_type", "format", "text"]);

/** Apply a column mapping. Rows without a valid date are skipped and counted, never guessed. */
export function interpretRows(
  table: Pick<Table, "rows">,
  mapping: ColumnMapping,
  dateFormat: DateFormat,
): InterpretResult {
  const dateCol = Object.entries(mapping).find(([, f]) => f === "date")?.[0];
  if (dateCol === undefined) throw localizedError("validation", "audit.errors.mapDateColumn");
  const out: InterpretResult = { rows: [], invalid: [] };
  table.rows.forEach((cells, i) => {
    const rowNumber = i + 2; // 1-based, after the header row
    const postedOn = parseDateCell(cells[Number(dateCol)] ?? "", dateFormat);
    if (!postedOn) {
      out.invalid.push({ rowNumber, reason: "Invalid date" });
      return;
    }
    const row: InterpretedRow = { rowNumber, postedOn, metrics: {} };
    for (const [col, field] of Object.entries(mapping)) {
      if (field === "ignore" || field === "date") continue;
      const raw = (cells[Number(col)] ?? "").trim();
      if (!raw) continue;
      if (TEXT_FIELDS.has(field)) {
        if (field === "post_type") row.postType = raw.slice(0, 60);
        else if (field === "format") row.format = raw.slice(0, 60);
        else row.text = raw.slice(0, 4000);
      } else {
        const n = parseStrictNumber(raw);
        if (n !== null) row.metrics[field] = n;
      }
    }
    out.rows.push(row);
  });
  return out;
}

// Header synonyms in Italian and English: they match column names of exported analytics files.
const HEADER_HINTS: Array<[RegExp, SocialPostField]> = [
  [/^(data|date|giorno|publish|pubblica)/i, "date"],
  [/(tipo|type)/i, "post_type"],
  [/(formato|format)/i, "format"],
  [/(testo|caption|descri|text|message|messaggio)/i, "text"],
  [/(visualizzaz|views|plays|riproduz)/i, "views"],
  [/(copertura|reach)/i, "reach"],
  [/(impression)/i, "impressions"],
  [/(interaz|engagement|interactions)/i, "interactions"],
  [/(mi piace|like|reaz|reaction)/i, "likes"],
  [/(comment)/i, "comments"],
  [/(salvat|saves|saved)/i, "saves"],
  [/(condivis|share)/i, "shares"],
  [/(clic|click)/i, "clicks"],
  [/^ctr$/i, "ctr"],
  [/(follower).*(acquisit|gained|new)/i, "followers_gained"],
  [/(follower).*(pers|lost)/i, "followers_lost"],
  [/(follower)/i, "followers"],
  [/(visite|visits|page views)/i, "page_visits"],
  [/(lead)/i, "leads"],
];

/** Suggested mapping from the header names; the person can change every column. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const used = new Set<SocialPostField>();
  const mapping: ColumnMapping = {};
  headers.forEach((h, i) => {
    const hit = HEADER_HINTS.find(([re, field]) => re.test(h) && !used.has(field));
    mapping[i] = hit ? hit[1] : "ignore";
    if (hit) used.add(hit[1]);
  });
  return mapping;
}
