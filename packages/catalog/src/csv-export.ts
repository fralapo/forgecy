import { fieldDefs, formatValue } from "./fields";
import type { CatalogRow } from "./queries";

/** UTF-8 byte order mark, so Excel opens accented text correctly. */
const BOM = "\uFEFF";

const statusLabels: Record<string, string> = {
  draft: "Bozza",
  proposed: "Proposto",
  approved: "Approvato",
  rejected: "Rifiutato",
  archived: "Archiviato",
};

/** Quote a CSV cell; neutralize formulas so the file is safe to open in a spreadsheet. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "Esporta CSV" of the filtered products (UTF-8 with BOM, semicolon, opens in Excel Italia). */
export function productsToCsv(rows: CatalogRow[]): string {
  const header = ["Stato", ...fieldDefs.map((f) => f.label), "Fonte"];
  const lines = [header.map(csvCell).join(";")];
  for (const r of rows)
    lines.push(
      [
        statusLabels[r.status] ?? r.status,
        ...fieldDefs.map((f) => formatValue(f.key, r.fields[f.key])),
        r.source,
      ]
        .map(csvCell)
        .join(";"),
    );
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** "Scarica rapporto degli scarti". */
export function discardsToCsv(rows: Array<{ reason: string; source: string }>): string {
  const lines = [["Motivo", "Fonte"].map(csvCell).join(";")];
  for (const r of rows) lines.push([r.reason, r.source].map(csvCell).join(";"));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
