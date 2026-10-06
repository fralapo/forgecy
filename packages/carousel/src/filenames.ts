import { FORMATS, type FormatId } from "./formats";

/** "Rossi S.r.l." → "rossi-srl": lowercase ASCII, digits and single dashes. */
export function slugify(input: string, max = 40): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "senza-nome";
}

export interface ExportNameInput {
  client: string;
  content: string;
  version: number;
  format: FormatId;
  /** Watermarked preview before approval: `_bozza` suffix. */
  draft?: boolean;
}

/**
 * Deterministic export names (spec UXA-P4-47):
 * `{cliente}_{contenuto}_v{n}_{formato}_{nn}.png`, `…_{formato}.pdf`, `…_{formato}.zip`.
 * Same carousel version → same names, every time.
 */
export function exportBaseName(input: ExportNameInput): string {
  const base = `${slugify(input.client)}_${slugify(input.content)}_v${input.version}_${FORMATS[input.format].fileSlug}`;
  return input.draft ? `${base}_bozza` : base;
}

export function exportFileNames(input: ExportNameInput & { slides: number }) {
  const base = exportBaseName(input);
  const pad = Math.max(2, String(input.slides).length);
  const nn = (i: number) => String(i + 1).padStart(pad, "0");
  const png = Array.from({ length: input.slides }, (_, i) =>
    input.draft ? `${base.replace(/_bozza$/, "")}_${nn(i)}_bozza.png` : `${base}_${nn(i)}.png`,
  );
  return { png, pdf: `${base}.pdf`, zip: `${base}.zip` };
}
