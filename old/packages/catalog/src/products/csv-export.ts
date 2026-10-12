import { fieldDefs, formatValue, type FieldKey } from "./fields";
import type { CatalogRow } from "./queries";

/** UTF-8 byte order mark, so Excel opens accented text correctly. */
const BOM = "\uFEFF";

const statusLabels: Record<string, string> = {
  draft: "Draft",
  proposed: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
};

/** Quote a CSV cell; neutralize formulas so the file is safe to open in a spreadsheet. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Texts of a CSV export in the language of the person exporting (English by default). */
export interface CsvLabels {
  status: string;
  source: string;
  reason: string;
  field: (key: FieldKey) => string;
  statusOf: (status: string) => string;
  sourceOf: (row: CatalogRow) => string;
}

export const englishCsvLabels: CsvLabels = {
  status: "Status",
  source: "Source",
  reason: "Reason",
  field: (key) => fieldDefs.find((f) => f.key === key)?.label ?? key,
  statusOf: (status) => statusLabels[status] ?? status,
  sourceOf: (row) => row.source,
};

/**
 * "Export CSV" of the filtered products (UTF-8 with BOM, semicolon, opens in Excel with
 * Italian locale settings). Headers in any supported language are recognized by the import.
 */
export function productsToCsv(rows: CatalogRow[], labels: CsvLabels = englishCsvLabels): string {
  const header = [labels.status, ...fieldDefs.map((f) => labels.field(f.key)), labels.source];
  const lines = [header.map(csvCell).join(";")];
  for (const r of rows)
    lines.push(
      [
        labels.statusOf(r.status),
        ...fieldDefs.map((f) => formatValue(f.key, r.fields[f.key])),
        labels.sourceOf(r),
      ]
        .map(csvCell)
        .join(";"),
    );
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** "Download rejected rows report". */
export function discardsToCsv(
  rows: Array<{ reason: string; source: string }>,
  labels: Pick<CsvLabels, "reason" | "source"> = englishCsvLabels,
): string {
  const lines = [[labels.reason, labels.source].map(csvCell).join(";")];
  for (const r of rows) lines.push([r.reason, r.source].map(csvCell).join(";"));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
