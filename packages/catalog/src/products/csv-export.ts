import { fieldDefs, formatValue } from "./fields";
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

/** "Export CSV" of the filtered products (UTF-8 with BOM, semicolon, opens in Excel with Italian locale settings). */
export function productsToCsv(rows: CatalogRow[]): string {
  const header = ["Status", ...fieldDefs.map((f) => f.label), "Source"];
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

/** "Download rejected rows report". */
export function discardsToCsv(rows: Array<{ reason: string; source: string }>): string {
  const lines = [["Reason", "Source"].map(csvCell).join(";")];
  for (const r of rows) lines.push([r.reason, r.source].map(csvCell).join(";"));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
