/**
 * Text helpers. Everything read from client files is data: it is normalized to plain
 * text here and never interpreted as markup or instructions.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  egrave: "è",
  eacute: "é",
  agrave: "à",
  ograve: "ò",
  ugrave: "ù",
  igrave: "ì",
  euro: "€",
  deg: "°",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  reg: "®",
  copy: "©",
  trade: "™",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/**
 * WordPress/WooCommerce descriptions carry HTML. Keep the text and the line structure,
 * drop tags, scripts, styles and shortcodes.
 */
export function htmlToText(input: string): string {
  if (!/[<&[]/.test(input)) return input.trim();
  return decodeEntities(
    input
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/\[\/?[a-z_][\w-]*(\s[^\]]*)?\]/gi, ""),
  )
    .replace(/\\n/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Lowercase, no accents, only letters and digits: used to compare headers, names and file names. */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Compact form for SKU comparison: "RS-CV 050" and "rscv050" are the same code. */
export function normalizeSku(s: string): string {
  return s
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Split a cell holding a list ("a, b | c" or one item per line). */
export function splitList(value: string, separator?: string): string[] {
  const parts = separator ? value.split(separator) : value.split(/\r?\n|\s*[|;]\s*|,\s+(?=\S)/);
  return parts.map((p) => p.replace(/^[-•*]\s*/, "").trim()).filter((p) => p.length > 0);
}

/** Clamp a string so a malicious file cannot blow up rows or prompts. */
export function clampText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** File name without folders and extension. */
export function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Folder segments of a relative path ("foto/crema/1.jpg" → ["foto", "crema"]). */
export function folderSegments(path: string): string[] {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, -1);
}
