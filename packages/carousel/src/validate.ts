import { parseHTML } from "linkedom";
import { z } from "zod";
import { resolvePackagePath } from "./css";
import { FORMATS } from "./formats";
import {
  MANIFEST_FILE,
  type TemplatePackage,
  isSafePackagePath,
  parseManifest,
  readText,
} from "./package";
import { ALLOWED_ELEMENTS } from "./sanitize";
import { checkSlideAgainstLayout, slideSchema } from "./slide-schema";
import type { TemplateManifest } from "./template-schema";

/**
 * Template validation as shown in the Template editor checklist (spec page 37). Every
 * problem carries the file and line so the editor can point at it. Static checks live
 * here; the render checks (test render, long text overflow) run in the worker and are
 * appended by `@forgecy/carousel/export`.
 */
export type IssueCode = "TEMPLATE-INVALID" | "ASSET-MISSING";
export type CheckStatus = "ok" | "error" | "warning" | "skipped";

export interface ValidationIssue {
  code: IssueCode;
  check: string;
  message: string;
  file?: string;
  line?: number;
  layout?: string;
}

export interface ValidationCheck {
  id: string;
  label: string;
  status: CheckStatus;
}

export interface ValidationReport {
  ok: boolean;
  checks: ValidationCheck[];
  issues: ValidationIssue[];
  /** Present when template.json parsed. */
  manifest?: TemplateManifest;
}

const BUILTIN_VARS = new Set([
  "--fc-width",
  "--fc-height",
  "--fc-safe-top",
  "--fc-safe-right",
  "--fc-safe-bottom",
  "--fc-safe-left",
]);
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
  "inherit",
  "initial",
  "unset",
  "emoji",
]);
const NAMED_COLORS =
  /(^|[\s,(])(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|brown|gold|beige|ivory|coral|crimson|indigo|violet|tomato|salmon|khaki|tan)(?=$|[\s,);!])/i;
const COLOR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const HEX = /#[0-9a-f]{3,8}\b/i;

/** Blank out comments keeping newlines, so line numbers stay right. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function literalColor(value: string): string | undefined {
  const v = value.replace(/var\([^)]*\)/g, "");
  return (
    v.match(HEX)?.[0] ?? v.match(COLOR_FN)?.[0]?.replace(/\s*\($/, "") ?? v.match(NAMED_COLORS)?.[2]
  );
}

interface CssFacts {
  usedVars: { name: string; line: number }[];
  definedVars: Set<string>;
  families: { name: string; line: number }[];
}

function scanDeclarations(
  text: string,
  file: string,
  m: TemplateManifest,
  issues: ValidationIssue[],
  facts: CssFacts,
  lineOffset = 0,
): void {
  const clean = stripCssComments(text);
  const decl = /(--[a-z0-9-]+|[a-z-]+)\s*:\s*([^;{}]+)/gi;
  for (const match of clean.matchAll(decl)) {
    const prop = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    const line = lineOf(clean, match.index) + lineOffset;
    if (prop.startsWith("--")) facts.definedVars.add(prop);
    const color = literalColor(value);
    if (color && !value.startsWith("data:"))
      issues.push({
        code: "TEMPLATE-INVALID",
        check: "hardcoded",
        file,
        line,
        message: `colore \`${color}\` scritto a mano. Usa un ruolo colore (variabile CSS).`,
      });
    if (prop === "font-size" && m.typeScale.length) {
      const px = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (px && !m.typeScale.includes(Number(px[1])))
        issues.push({
          code: "TEMPLATE-INVALID",
          check: "hardcoded",
          file,
          line,
          message: `\`font-size: ${value}\` fuori dalla scala tipografica.`,
        });
    }
    if (prop === "font-family" || prop === "font") {
      const list =
        prop === "font" ? (value.match(/(?:\d|px|em|rem|%|normal)\s+(.+)$/)?.[1] ?? "") : value;
      for (const raw of list.split(",")) {
        const name = raw.trim().replace(/^["']|["']$/g, "");
        if (!name || name.startsWith("var(") || GENERIC_FONTS.has(name.toLowerCase())) continue;
        facts.families.push({ name, line });
      }
    }
    for (const v of value.matchAll(/var\(\s*(--[a-z0-9-]+)/gi))
      facts.usedVars.push({ name: v[1]!.toLowerCase(), line });
  }
}

function checkCss(pkg: TemplatePackage, path: string, issues: ValidationIssue[], facts: CssFacts) {
  const css = readText(pkg, path) ?? "";
  const clean = stripCssComments(css);
  const bad: [RegExp, string][] = [
    [/@import/gi, "`@import` non ammesso: tutto deve stare nel pacchetto."],
    [/@font-face/gi, "`@font-face` non ammesso: dichiara i font in template.json."],
    [/expression\s*\(/gi, "`expression()` non ammesso."],
  ];
  for (const [re, message] of bad)
    for (const match of clean.matchAll(re))
      issues.push({
        code: "TEMPLATE-INVALID",
        check: "markup",
        file: path,
        line: lineOf(clean, match.index),
        message,
      });
  for (const match of clean.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    const ref = match[2]!.trim();
    const target = resolvePackagePath(path, ref);
    const line = lineOf(clean, match.index);
    if (!target)
      issues.push({
        code: "TEMPLATE-INVALID",
        check: "markup",
        file: path,
        line,
        message: `\`url(${ref})\` esterno: usa un file di \`assets/\`.`,
      });
    else if (!pkg.files.has(target))
      issues.push({
        code: "ASSET-MISSING",
        check: "files",
        file: path,
        line,
        message: `\`${ref}\` non è nel pacchetto.`,
      });
  }
  scanDeclarations(css, path, pkg.manifest, issues, facts);
}

function checkLayoutHtml(
  pkg: TemplatePackage,
  layoutIndex: number,
  issues: ValidationIssue[],
  facts: CssFacts,
): number {
  const m = pkg.manifest;
  const layout = m.layouts[layoutIndex]!;
  const file = layout.file;
  const html = readText(pkg, file);
  if (html === undefined) return 0;
  const push = (code: IssueCode, check: string, message: string, at?: number) =>
    issues.push({
      code,
      check,
      file,
      layout: layout.id,
      message,
      ...(at !== undefined ? { line: lineOf(html, at) } : {}),
    });

  for (const match of html.matchAll(/<\s*([a-z][a-z0-9-]*)/gi)) {
    const tag = match[1]!.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tag))
      push(
        "TEMPLATE-INVALID",
        "markup",
        `elemento \`<${tag}>\` non ammesso nei layout.`,
        match.index,
      );
  }
  for (const match of html.matchAll(/\s(on[a-z]+)\s*=/gi))
    push("TEMPLATE-INVALID", "markup", `attributo \`${match[1]}\` non ammesso.`, match.index);
  for (const match of html.matchAll(/\s(?:src|href)\s*=\s*["']?\s*([a-z][a-z0-9+.-]*:|\/\/)/gi))
    push(
      "TEMPLATE-INVALID",
      "markup",
      `riferimento esterno \`${match[1]}\`: usa un file di \`assets/\`.`,
      match.index,
    );
  for (const match of html.matchAll(/\ssrc\s*=\s*["']([^"']+)["']/gi)) {
    const target = resolvePackagePath(file, match[1]!);
    if (target && !pkg.files.has(target))
      push("ASSET-MISSING", "files", `\`${match[1]}\` non è nel pacchetto.`, match.index);
  }
  for (const match of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi))
    scanDeclarations(match[1]!, file, m, issues, facts, lineOf(html, match.index) - 1);
  for (const match of html.matchAll(/\s(fill|stroke|stop-color)\s*=\s*"([^"]*)"/gi)) {
    const c = literalColor(match[2]!);
    if (c)
      push(
        "TEMPLATE-INVALID",
        "hardcoded",
        `colore \`${c}\` scritto a mano. Usa un ruolo colore (variabile CSS).`,
        match.index,
      );
  }

  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const found = new Map<string, Element>();
  for (const el of document.querySelectorAll("[data-slot]")) {
    const name = el.getAttribute("data-slot") ?? "";
    if (found.has(name))
      push(
        "TEMPLATE-INVALID",
        "slots",
        `slot "${name}" presente due volte.`,
        html.indexOf(`data-slot="${name}"`),
      );
    found.set(name, el);
  }
  for (const slot of layout.slots) {
    const el = found.get(slot.name);
    if (!el) {
      push(
        "TEMPLATE-INVALID",
        "slots",
        `lo slot "${slot.name}" è in template.json ma non nell'HTML.`,
      );
      continue;
    }
    const at = html.indexOf(`data-slot="${slot.name}"`);
    const tag = el.localName.toLowerCase();
    if (slot.type === "image" && tag !== "img")
      push(
        "TEMPLATE-INVALID",
        "slots",
        `lo slot immagine "${slot.name}" deve essere un \`<img>\`.`,
        at,
      );
    if (slot.type === "list" && (!["ul", "ol"].includes(tag) || !el.querySelector("li")))
      push(
        "TEMPLATE-INVALID",
        "slots",
        `lo slot elenco "${slot.name}" deve essere \`<ul>\` o \`<ol>\` con un \`<li>\` di esempio.`,
        at,
      );
    if (slot.type === "text" && tag === "img")
      push(
        "TEMPLATE-INVALID",
        "slots",
        `lo slot di testo "${slot.name}" non può essere un \`<img>\`.`,
        at,
      );
  }
  for (const name of found.keys())
    if (!layout.slots.some((s) => s.name === name))
      push(
        "TEMPLATE-INVALID",
        "slots",
        `lo slot "${name}" è nell'HTML ma non in template.json.`,
        html.indexOf(`data-slot="${name}"`),
      );
  return found.size;
}

function fontKind(bytes: Uint8Array): string | undefined {
  const sig = String.fromCharCode(...bytes.slice(0, 4));
  if (sig === "wOF2") return "WOFF2";
  if (sig === "wOFF") return "WOFF";
  if (sig === "OTTO") return "OTF";
  if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return "TTF";
  return undefined;
}

/** Static validation of a template package (no browser needed). */
export function validateTemplatePackage(files: ReadonlyMap<string, Uint8Array>): ValidationReport {
  const issues: ValidationIssue[] = [];
  const checks: ValidationCheck[] = [];
  const add = (id: string, label: string, failIf = true) => {
    const mine = issues.filter((i) => i.check === id);
    checks.push({ id, label, status: failIf && mine.length ? "error" : "ok" });
  };

  for (const path of files.keys())
    if (!isSafePackagePath(path))
      issues.push({
        code: "TEMPLATE-INVALID",
        check: "manifest",
        file: path,
        message: "percorso non ammesso nel pacchetto.",
      });

  const parsed = parseManifest(readText({ files }, MANIFEST_FILE));
  if (!parsed.ok) {
    for (const e of parsed.errors)
      issues.push({
        code: "TEMPLATE-INVALID",
        check: "manifest",
        file: MANIFEST_FILE,
        message: `${e.path}: ${e.message}`,
      });
    add("manifest", "`template.json` valido");
    return { ok: false, checks, issues };
  }
  const m = parsed.manifest;
  const pkg: TemplatePackage = { manifest: m, files };
  add("manifest", "`template.json` valido");

  for (const p of [...m.styles, ...m.layouts.map((l) => l.file), ...m.fonts.map((f) => f.file)])
    if (!files.has(p))
      issues.push({
        code: "ASSET-MISSING",
        check: "files",
        file: p,
        message: `\`${p}\` dichiarato in template.json ma assente.`,
      });

  const facts: CssFacts = { usedVars: [], definedVars: new Set(), families: [] };
  for (const s of m.styles) if (files.has(s)) checkCss(pkg, s, issues, facts);
  let slotCount = 0;
  m.layouts.forEach((_, i) => (slotCount += checkLayoutHtml(pkg, i, issues, facts)));

  // Every variable a style reads must be a mapped role, a renderer variable or defined by the template.
  const mapped = new Set([...Object.keys(m.colorRoles), ...Object.keys(m.fontRoles)]);
  for (const { name, line } of facts.usedVars)
    if (!mapped.has(name) && !BUILTIN_VARS.has(name) && !facts.definedVars.has(name))
      issues.push({
        code: "TEMPLATE-INVALID",
        check: "hardcoded",
        line,
        message: `la variabile \`${name}\` non è legata a un ruolo colore o font.`,
      });

  // Fonts: real font files, and every family used is shipped in fonts/.
  const kinds = new Set<string>();
  for (const f of m.fonts) {
    const bytes = files.get(f.file);
    if (!bytes) continue;
    const kind = fontKind(bytes);
    if (!kind)
      issues.push({
        code: "ASSET-MISSING",
        check: "fonts",
        file: f.file,
        message: "il file non è un font WOFF2, WOFF, TTF o OTF.",
      });
    else kinds.add(kind);
  }
  const shipped = new Set(m.fonts.map((f) => f.family.toLowerCase()));
  const roleFallbacks = Object.values(m.fontRoles).map((r) => r.fallback);
  for (const name of [...new Set([...facts.families.map((f) => f.name), ...roleFallbacks])])
    if (!shipped.has(name.toLowerCase()))
      issues.push({
        code: "ASSET-MISSING",
        check: "fonts",
        message: `il template usa "${name}" ma il font non è in \`fonts/\`.`,
      });

  // Samples must be valid slides: they feed the catalog cover, previews and the test render.
  for (const layout of m.layouts) {
    const slide = slideSchema.safeParse({ layout: layout.id, slots: layout.sample });
    if (!slide.success) {
      issues.push({
        code: "TEMPLATE-INVALID",
        check: "samples",
        file: MANIFEST_FILE,
        layout: layout.id,
        message: `esempio del layout "${layout.id}" non valido.`,
      });
      continue;
    }
    const check = z
      .any()
      .superRefine((_v, ctx) => checkSlideAgainstLayout(slide.data, layout, ctx));
    const res = check.safeParse(null);
    if (!res.success)
      for (const i of res.error.issues)
        issues.push({
          code: "TEMPLATE-INVALID",
          check: "samples",
          file: MANIFEST_FILE,
          layout: layout.id,
          message: `esempio "${layout.id}": ${i.message}`,
        });
    for (const v of Object.values(layout.sample))
      if (v && typeof v === "object" && !Array.isArray(v) && !files.has(v.asset))
        issues.push({
          code: "ASSET-MISSING",
          check: "samples",
          file: MANIFEST_FILE,
          layout: layout.id,
          message: `\`${v.asset}\` non è nel pacchetto.`,
        });
  }

  add("files", "File dichiarati presenti nel pacchetto");
  add(
    "slots",
    `Slot dichiarati: ${m.layouts.reduce((n, l) => n + l.slots.length, 0)} in ${m.layouts.length} layout`,
  );
  checks.push({
    id: "slots-html",
    label: `Slot coerenti tra HTML e metadati (${slotCount} nell'HTML)`,
    status: issues.some((i) => i.check === "slots") ? "error" : "ok",
  });
  add("fonts", `Font inclusi: ${m.fonts.length}${kinds.size ? ` (${[...kinds].join(", ")})` : ""}`);
  add(
    "hardcoded",
    issues.some((i) => i.check === "hardcoded")
      ? "Valori hardcoded presenti"
      : "Valori hardcoded: nessuno",
  );
  add("markup", "Markup senza script né riferimenti esterni");
  add("samples", "Dati di esempio validi");
  checks.push({ id: "formats", label: `Formati: ${FORMATS[m.format].label}`, status: "ok" });

  return { ok: !issues.length, checks, issues, manifest: m };
}

/** «`layouts/cover.html`, riga 14: colore `#FF0000` scritto a mano.» */
export function formatIssue(i: ValidationIssue): string {
  const where = i.file ? `\`${i.file}\`${i.line ? `, riga ${i.line}` : ""}: ` : "";
  return `${where}${i.message}`;
}
