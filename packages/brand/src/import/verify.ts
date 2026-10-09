/** Deterministic checks that replace the human review of an import (ADR 0022). */

const QUOTES = /[‘’‛′`´]/g;
const DQUOTES = /[“”„″]/g;

export function normalizeText(s: string): string {
  return s
    .normalize("NFC")
    .replace(QUOTES, "'")
    .replace(DQUOTES, '"')
    .replace(/[\u00a0\u2000-\u200b]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when the quote, or every segment of it split on "…" / "...", is in the page text. */
export function quoteInPage(quote: string, pageText: string): boolean {
  const page = normalizeText(pageText);
  const parts = quote
    .split(/…|\.\.\./)
    .map(normalizeText)
    .filter((p) => p.length > 0);
  if (!parts.length) return false;
  return parts.every((p) => page.includes(p));
}

/** Palettes shipped by CSS frameworks and page builders: the framework, not the brand. */
export const FRAMEWORK_DEFAULT_HEXES: ReadonlySet<string> = new Set([
  // Bootstrap 4
  "#007bff",
  "#6c757d",
  "#28a745",
  "#dc3545",
  "#ffc107",
  "#17a2b8",
  "#f8f9fa",
  "#343a40",
  "#e83e8c",
  "#6610f2",
  "#fd7e14",
  "#20c997",
  // Bootstrap 5
  "#0d6efd",
  "#6f42c1",
  "#d63384",
  "#198754",
  "#0dcaf0",
  "#212529",
  "#adb5bd",
  "#e9ecef",
  // Elementor default global colors
  "#6ec1e4",
  "#54595f",
  "#7a7a7a",
  "#61ce70",
  "#4054b2",
  "#23a455",
  // WordPress Gutenberg default palette
  "#cf2e2e",
  "#ff6900",
  "#fcb900",
  "#7bdcb5",
  "#00d084",
  "#8ed1fc",
  "#0693e3",
  "#abb8c3",
  "#9b51e0",
  "#32373c",
]);

export function isFrameworkDefaultHex(hex: string): boolean {
  return FRAMEWORK_DEFAULT_HEXES.has(hex.trim().toLowerCase());
}

const GENERIC_FONTS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "arial",
  "helvetica",
  "helvetica neue",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "times",
  "times new roman",
  "courier",
  "courier new",
  "georgia",
  "lucida grande",
  "inherit",
  "initial",
]);

export function isGenericFont(family: string): boolean {
  return GENERIC_FONTS.has(
    family
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase(),
  );
}
