/**
 * Client design tokens in DTCG format on three levels (spec: "Identità visiva e
 * design token"): reference (raw palette), semantic (roles) and component (one
 * per layout slot). The renderer turns resolved tokens into CSS variables; the
 * model only ever sees role names, never values. Provenance of each token lives
 * in `$extensions.forgecy`, so the tree stays valid DTCG.
 */
import { checkContrast, colorToHex, flattenTokens, resolveValue, WCAG } from "@forgecy/ui/tokens";
import type { ConfidenceLevel } from "@forgecy/core";

export type TokenTree = Record<string, unknown>;

export interface DtcgColorValue {
  colorSpace: "srgb";
  components: [number, number, number];
  hex: string;
}

export interface ForgecyTokenExtension {
  sourceIds?: string[];
  confidence?: ConfidenceLevel;
  acceptedFromProposalId?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function normalizeHex(input: string): string | null {
  const h = input.trim().replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return /^[0-9a-f]{6}$/i.test(full) ? `#${full.toUpperCase()}` : null;
}

export function hexToDtcg(hex: string): DtcgColorValue {
  const h = normalizeHex(hex);
  if (!h) throw new Error(`Invalid hex color: ${hex}`);
  const c = [1, 3, 5].map((i) => Number((parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)));
  return { colorSpace: "srgb", components: c as [number, number, number], hex: h };
}

/** Semantic roles every client defines; layouts and the brand check rely on them. */
export const semanticColorRoles = [
  { path: "color.semantic.background", label: "Sfondo principale" },
  { path: "color.semantic.surface", label: "Superficie" },
  { path: "color.semantic.text-primary", label: "Testo principale" },
  { path: "color.semantic.text-secondary", label: "Testo secondario" },
  { path: "color.semantic.brand-primary", label: "Colore del brand" },
  { path: "color.semantic.on-brand-primary", label: "Testo sul colore del brand" },
  { path: "color.semantic.accent", label: "Accento" },
] as const;

/** Component tokens: one per slot of the catalog layouts. */
export const componentTokens = [
  { path: "component.slide.background", label: "Slide · sfondo", default: "background" },
  { path: "component.slide.title", label: "Slide · titolo", default: "text-primary" },
  { path: "component.slide.body", label: "Slide · testo", default: "text-secondary" },
  { path: "component.cover.background", label: "Copertina · sfondo", default: "brand-primary" },
  { path: "component.cover.title", label: "Copertina · titolo", default: "on-brand-primary" },
  { path: "component.cta.background", label: "CTA · sfondo", default: "brand-primary" },
  { path: "component.cta.text", label: "CTA · testo", default: "on-brand-primary" },
  { path: "component.progress.active", label: "Avanzamento · attivo", default: "accent" },
] as const;

/** Text/background pairs checked by the contrast matrix (spec 13.7). */
export const contrastPairs = [
  { fg: "color.semantic.text-primary", bg: "color.semantic.background", label: "Testo su sfondo" },
  {
    fg: "color.semantic.text-secondary",
    bg: "color.semantic.background",
    label: "Testo secondario su sfondo",
  },
  { fg: "color.semantic.text-primary", bg: "color.semantic.surface", label: "Testo su superficie" },
  {
    fg: "color.semantic.text-secondary",
    bg: "color.semantic.surface",
    label: "Testo secondario su superficie",
  },
  {
    fg: "color.semantic.on-brand-primary",
    bg: "color.semantic.brand-primary",
    label: "Testo sul colore del brand",
  },
  {
    fg: "color.semantic.brand-primary",
    bg: "color.semantic.background",
    label: "Colore del brand su sfondo",
  },
] as const;

const alias = (path: string) => `{${path}}`;

/** Starting tokens of an empty identity: neutral palette, every role wired. */
export function defaultTokens(): TokenTree {
  const semantic = (ref: string) => ({ $value: alias(`color.reference.${ref}`) });
  return {
    color: {
      $type: "color",
      reference: {
        white: { $value: hexToDtcg("#FFFFFF") },
        ink: { $value: hexToDtcg("#1A1A1A") },
        gray: { $value: hexToDtcg("#5C5C5C") },
      },
      semantic: {
        background: semantic("white"),
        surface: semantic("white"),
        "text-primary": semantic("ink"),
        "text-secondary": semantic("gray"),
        "brand-primary": semantic("ink"),
        "on-brand-primary": semantic("white"),
        accent: semantic("ink"),
      },
    },
    font: {
      family: {
        $type: "fontFamily",
        display: { $value: ["sans-serif"] },
        body: { $value: ["sans-serif"] },
      },
    },
    component: {
      $type: "color",
      ...nest(
        componentTokens.map((t) => [
          t.path.replace(/^component\./, ""),
          { $value: alias(`color.semantic.${t.default}`) },
        ]),
      ),
    },
  };
}

function nest(entries: Array<[string, unknown]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of entries) {
    const segs = path.split(".");
    let node = out;
    for (const s of segs.slice(0, -1)) node = (node[s] ??= {}) as Record<string, unknown>;
    node[segs.at(-1)!] = value;
  }
  return out;
}

/** Dot path → JSON Pointer under the `/tokens` root used by proposals. */
export const tokenPointer = (dotPath: string) => `/tokens/${dotPath.split(".").join("/")}`;

export interface ReferenceColor {
  name: string;
  hex: string;
  description?: string;
  extension?: ForgecyTokenExtension;
}

export function referenceColors(tree: TokenTree): ReferenceColor[] {
  const ref = (tree.color as Record<string, unknown> | undefined)?.reference;
  if (!isObject(ref)) return [];
  const out: ReferenceColor[] = [];
  for (const [name, node] of Object.entries(ref)) {
    if (name.startsWith("$") || !isObject(node) || !("$value" in node)) continue;
    try {
      const hex = colorToHex(node.$value as never);
      const ext = (node.$extensions as Record<string, unknown> | undefined)?.forgecy;
      out.push({
        name,
        hex,
        ...(typeof node.$description === "string" ? { description: node.$description } : {}),
        ...(isObject(ext) ? { extension: ext as ForgecyTokenExtension } : {}),
      });
    } catch {
      // Unreadable color: reported by validateTokens.
    }
  }
  return out;
}

export interface TokenIssue {
  path: string;
  message: string;
}

/** Structural checks: every alias resolves, no cycles, colors readable. */
export function validateTokens(tree: TokenTree): TokenIssue[] {
  const issues: TokenIssue[] = [];
  let flat;
  try {
    flat = flattenTokens(tree);
  } catch (err) {
    return [{ path: "", message: (err as Error).message }];
  }
  for (const [path, token] of flat) {
    if (/[{}]/.test(path) || path.split(".").some((s) => s.startsWith("$")))
      issues.push({ path, message: "Nome di token non valido" });
    try {
      const v = resolveValue(flat, path);
      if (token.type === "color" || path.startsWith("color.") || path.startsWith("component."))
        colorToHex(v as never);
    } catch (err) {
      issues.push({ path, message: (err as Error).message });
    }
  }
  for (const role of semanticColorRoles)
    if (!flat.has(role.path)) issues.push({ path: role.path, message: "Ruolo semantico mancante" });
  return issues;
}

/** Resolved values by dot path (aliases followed). Unresolvable tokens are left out. */
export function resolveTokens(tree: TokenTree): Map<string, unknown> {
  const flat = flattenTokens(tree);
  const out = new Map<string, unknown>();
  for (const path of flat.keys()) {
    try {
      out.set(path, resolveValue(flat, path));
    } catch {
      // skipped: validateTokens reports it
    }
  }
  return out;
}

export function tokenColorHex(tree: TokenTree, path: string): string | null {
  try {
    return colorToHex(resolveValue(flattenTokens(tree), path) as never);
  } catch {
    return null;
  }
}

/**
 * CSS custom properties for the renderer: `--brand-color-semantic-background: #FFFFFF`.
 * Colors become hex, font families a CSS list, everything else its string form.
 */
export function tokensToCssVars(tree: TokenTree, prefix = "brand"): Record<string, string> {
  const flat = flattenTokens(tree);
  const out: Record<string, string> = {};
  for (const [path, token] of flat) {
    let v: unknown;
    try {
      v = resolveValue(flat, path);
    } catch {
      continue;
    }
    const name = `--${prefix}-${path.replace(/\./g, "-")}`;
    if (token.type === "fontFamily" || path.startsWith("font.family."))
      out[name] = (Array.isArray(v) ? v : [v])
        .map((f) => (/^[\w-]+$/.test(String(f)) ? String(f) : `"${String(f)}"`))
        .join(", ");
    else if (isObject(v) && "colorSpace" in v) out[name] = colorToHex(v as never);
    else if (typeof v === "string" || typeof v === "number") out[name] = String(v);
  }
  return out;
}

/** Role names the model may reference (e.g. "component.cover.background"); values never leave. */
export function tokenRoleNames(tree: TokenTree): string[] {
  return [...flattenTokens(tree).keys()].filter(
    (p) => p.startsWith("color.semantic.") || p.startsWith("component."),
  );
}

export interface ContrastCell {
  fg: string;
  bg: string;
  label: string;
  fgHex: string | null;
  bgHex: string | null;
  ratio: number | null;
  /** "normal" passes 4.5:1, "large" only 3:1 (text ≥ 68 px canvas or 54 px bold), "fail" neither. */
  grade: "normal" | "large" | "fail" | "unknown";
}

export function gradeRatio(ratio: number): ContrastCell["grade"] {
  return ratio >= WCAG.text ? "normal" : ratio >= WCAG.largeText ? "large" : "fail";
}

/** Contrast of the semantic text/background pairs. Logos are excluded by design. */
export function contrastMatrix(tree: TokenTree): ContrastCell[] {
  return contrastPairs.map((p) => {
    const fgHex = tokenColorHex(tree, p.fg);
    const bgHex = tokenColorHex(tree, p.bg);
    const ratio = fgHex && bgHex ? checkContrast(fgHex, bgHex) : null;
    return {
      ...p,
      fgHex,
      bgHex,
      ratio,
      grade: ratio === null ? "unknown" : gradeRatio(ratio),
    };
  });
}

/** Every reference color against every other: the palette grid of the Visual page. */
export function paletteMatrix(
  tree: TokenTree,
): Array<{ fg: string; bg: string; ratio: number; grade: ContrastCell["grade"] }> {
  const colors = referenceColors(tree);
  const out = [];
  for (const fg of colors)
    for (const bg of colors) {
      if (fg.name === bg.name) continue;
      const ratio = checkContrast(fg.hex, bg.hex);
      out.push({ fg: fg.name, bg: bg.name, ratio, grade: gradeRatio(ratio) });
    }
  return out;
}

/** Token paths present in `before` and missing in `after` (templates may still use them). */
export function removedTokenPaths(before: TokenTree, after: TokenTree): string[] {
  const a = flattenTokens(before);
  const b = flattenTokens(after);
  return [...a.keys()].filter((k) => !b.has(k)).sort();
}

/** Valid DTCG token name for a reference color: lowercase, dashes, no reserved chars. */
export function tokenNameFrom(label: string, fallback: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}
