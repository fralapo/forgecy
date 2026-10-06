import type { ApprovalBlocker, FileMeta, SourceRef } from "@forgecy/catalog";
import type { FieldKey } from "@forgecy/catalog/fields";
import type { Format } from "@forgecy/i18n";
import type { useTranslations } from "next-intl";

/** Translator of the `products` namespace (server `getTranslations` or client `useTranslations`). */
export type ProductsT = ReturnType<typeof useTranslations<"products">>;

/** “today 10:42” or the date, used for last-modified. */
export function shortWhen(t: ProductsT, format: Format, d: Date): string {
  if (d.toDateString() === new Date().toDateString())
    return t("list.todayAt", { time: format.date(d, "time") });
  return format.date(d);
}

/** “Import of 6 Oct 2026”. */
export function importTitle(t: ProductsT, format: Format, createdAt: Date): string {
  return t("import.importOf", { date: format.date(createdAt) });
}

export function formatUsd(format: Format, v: number): string {
  return format.currency(v, "USD");
}

/** File sizes: B, KB, MB are symbols; the number follows the language. */
export function formatBytes(format: Format, n: number): string {
  const one = { maximumFractionDigits: 1 };
  if (n < 1024) return `${format.number(n)} B`;
  if (n < 1024 * 1024) return `${format.number(n / 1024, one)} KB`;
  return `${format.number(n / 1024 / 1024, one)} MB`;
}

/** The import step stored on failure (“scan”, “extract”), in the user's language. */
export function stepLabel(t: ProductsT, step: string): string {
  return step === "scan" || step === "extract" ? t(`steps.${step}`) : step;
}

export function fieldLabel(t: ProductsT, key: FieldKey): string {
  return t(`fields.${key}`);
}

/** Where a value comes from: “CSV · list.csv · row 42, column "desc"”, “PDF · list.pdf p. 7”... */
export function sourceText(t: ProductsT, s: SourceRef): string {
  const file = s.fileName;
  switch (s.kind) {
    case "csv":
    case "xlsx": {
      const where = [
        s.row ? t("sources.row", { row: String(s.row) }) : "",
        s.column ? t("sources.column", { column: s.column }) : "",
      ]
        .filter(Boolean)
        .join(", ");
      return [s.kind.toUpperCase(), file, where].filter(Boolean).join(" · ");
    }
    case "pdf": {
      const head = ["PDF", file].filter(Boolean).join(" · ");
      return s.page ? `${head} ${t("sources.pdfPage", { page: String(s.page) })}` : head;
    }
    case "image":
      return file ? t("sources.imageNamed", { file }) : t("sources.image");
    case "text":
      return [t("sources.text"), file].filter(Boolean).join(" · ");
    case "ai":
      return t("sources.agent");
    case "manual":
      return s.userName ? t("sources.manualBy", { name: s.userName }) : t("sources.manual");
  }
}

/** Why a product cannot be approved yet, in the interface language. */
export function blockerText(t: ProductsT, b: ApprovalBlocker): string {
  if (b.kind === "missing")
    return t("blockers.missing", {
      fields: b.fields.map((k) => fieldLabel(t, k).toLocaleLowerCase()).join(", "),
    });
  return t("blockers.sensitive", { field: fieldLabel(t, b.field), claim: t(`claims.${b.claim}`) });
}

/**
 * Reasons stored by the import in English (the schema has no reference column for them):
 * the known ones are translated here; reasons typed by a person or by the AI stay as written.
 */
export function discardText(t: ProductsT, reason: string): string {
  if (reason === "Product without a name") return t("discards.noName");
  if (reason === "Rejected in review") return t("discards.inReview");
  let m = /^Row (\d+): missing name$/.exec(reason);
  if (m) return t("discards.rowNoName", { row: m[1]! });
  m = /^Row (\d+): variation without a parent product$/.exec(reason);
  if (m) return t("discards.rowNoParent", { row: m[1]! });
  m = /^Page (\d+): ([\s\S]*)$/.exec(reason);
  if (m) return t("discards.page", { page: m[1]!, reason: m[2]! });
  return reason;
}

/** Why an imported row looks like a catalog product (stored in English by the import). */
export function matchReasonText(t: ProductsT, reason: string | null): string {
  if (!reason) return t("matchReasons.possible");
  if (reason === "Same name and category") return t("matchReasons.nameCategory");
  const m = /^Same SKU (.+)$/.exec(reason);
  return m ? t("matchReasons.sku", { sku: m[1]! }) : reason;
}

/** Validation text of a valid import file, from what the import read (rows, pages, contents). */
export function validFileText(t: ProductsT, f: { kind: string; meta: unknown }): string {
  const meta = (f.meta ?? {}) as FileMeta;
  switch (f.kind) {
    case "sheet":
      return t("files.sheet", { rows: meta.rows ?? 0 });
    case "pdf":
      return meta.textless
        ? t("files.pdfTextless", { pages: meta.pages ?? 0 })
        : t("files.pdf", { pages: meta.pages ?? 0 });
    case "text":
      return t("files.text");
    case "archive": {
      const a = meta.archive;
      if (!a) return t("files.valid");
      const parts = [
        a.sheets ? t("files.zipSheets", { count: a.sheets }) : "",
        a.images ? t("files.zipImages", { count: a.images }) : "",
        a.pdfs ? t("files.zipPdfs", { count: a.pdfs }) : "",
        a.texts ? t("files.zipTexts", { count: a.texts }) : "",
      ].filter(Boolean);
      const head = parts.length
        ? t("files.zip", { contents: parts.join(", ") })
        : t("files.zipEmpty");
      return a.ignored ? `${head} · ${t("files.zipIgnored", { count: a.ignored })}` : head;
    }
    default:
      return t("files.valid");
  }
}
