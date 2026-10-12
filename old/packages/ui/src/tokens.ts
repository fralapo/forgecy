// DTCG (Design Tokens Format Module 2025.10) reader, CSS generator and WCAG contrast helpers.
// Pure and dependency-free: safe in the browser, in server components and in Node scripts.

export type TokenType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "duration"
  | "cubicBezier"
  | "number"
  | "shadow"
  | "typography";

export interface DtcgColor {
  colorSpace: string;
  components: readonly (number | "none")[];
  alpha?: number;
  hex?: string;
}

export interface DtcgDimension {
  value: number;
  unit: "px" | "rem" | "ms" | "s";
}

export interface FlatToken {
  path: string;
  type: TokenType | undefined;
  /** Raw `$value`, aliases unresolved. */
  value: unknown;
  description: string | undefined;
}

export type TokenTree = { readonly [key: string]: unknown };
export type Theme = "light" | "dark";

const ALIAS = /^\{([^{}]+)\}$/;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isAlias = (v: unknown): v is string => typeof v === "string" && ALIAS.test(v);
const aliasTarget = (v: string): string => (ALIAS.exec(v)?.[1] ?? "").trim();

/** Flattens a DTCG tree into dot paths, applying `$type` inheritance from groups. */
export function flattenTokens(tree: TokenTree): Map<string, FlatToken> {
  const out = new Map<string, FlatToken>();
  const walk = (
    node: Record<string, unknown>,
    path: string[],
    inherited: TokenType | undefined,
  ) => {
    const type = (node.$type as TokenType | undefined) ?? inherited;
    if ("$value" in node) {
      const p = path.join(".");
      out.set(p, {
        path: p,
        type,
        value: node.$value,
        description: typeof node.$description === "string" ? node.$description : undefined,
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$") || !isObject(child)) continue;
      walk(child, [...path, key], type);
    }
  };
  walk(tree as Record<string, unknown>, [], undefined);
  return out;
}

/** Resolves aliases (whole-value and nested in composites). Throws on missing or circular refs. */
export function resolveValue(
  tokens: Map<string, FlatToken>,
  path: string,
  seen: string[] = [],
): unknown {
  if (seen.includes(path)) throw new Error(`Circular token alias: ${[...seen, path].join(" -> ")}`);
  const token = tokens.get(path);
  if (!token)
    throw new Error(`Unknown token: ${path}${seen.length ? ` (from ${seen.at(-1)})` : ""}`);
  const chain = [...seen, path];
  const deep = (v: unknown): unknown => {
    if (isAlias(v)) return resolveValue(tokens, aliasTarget(v), chain);
    if (Array.isArray(v)) return v.map(deep);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
    return v;
  };
  return deep(token.value);
}

/** Resolves the `$type` of a token, following aliases when the token itself has none. */
export function resolveType(tokens: Map<string, FlatToken>, path: string): TokenType | undefined {
  const token = tokens.get(path);
  if (!token) return undefined;
  if (token.type) return token.type;
  return isAlias(token.value) ? resolveType(tokens, aliasTarget(token.value)) : undefined;
}

// ---------- Value formatting ----------

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const to255 = (n: number | "none") => Math.round(clamp01(n === "none" ? 0 : n) * 255);
const hex2 = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();

/** Converts a DTCG color (or hex string) to an sRGB `#RRGGBB` hex, ignoring alpha. */
export function colorToHex(color: DtcgColor | string): string {
  if (typeof color === "string") return normalizeHex(color);
  if (color.hex) return normalizeHex(color.hex);
  if (color.colorSpace !== "srgb")
    throw new Error(`Unsupported colorSpace without hex fallback: ${color.colorSpace}`);
  return `#${color.components.map((c) => hex2(to255(c))).join("")}`;
}

function normalizeHex(hex: string): string {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Invalid hex color: ${hex}`);
  return `#${full.toUpperCase()}`;
}

export function formatColor(color: DtcgColor | string): string {
  const hex = colorToHex(color);
  const alpha = typeof color === "string" ? 1 : (color.alpha ?? 1);
  if (alpha >= 1) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${round(alpha, 3)})`;
}

const round = (n: number, d = 4) => Number(n.toFixed(d));

export function formatDimension(d: DtcgDimension, as: "px" | "rem" = "px"): string {
  if (d.unit === "ms" || d.unit === "s") return `${d.value}${d.unit}`;
  if (as === "rem" && d.unit === "px") return `${round(d.value / 16)}rem`;
  return `${d.value}${d.unit}`;
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
]);

export function formatFontFamily(v: string | readonly string[]): string {
  const list = typeof v === "string" ? [v] : v;
  return list.map((f) => (GENERIC_FAMILIES.has(f) || /^[\w-]+$/.test(f) ? f : `"${f}"`)).join(", ");
}

function formatShadow(v: unknown): string {
  const layers = Array.isArray(v) ? v : [v];
  return layers
    .map((l) => {
      const s = l as {
        color: DtcgColor;
        offsetX: DtcgDimension;
        offsetY: DtcgDimension;
        blur: DtcgDimension;
        spread: DtcgDimension;
        inset?: boolean;
      };
      const parts = [s.offsetX, s.offsetY, s.blur, s.spread].map((d) => formatDimension(d));
      return `${s.inset ? "inset " : ""}${parts.join(" ")} ${formatColor(s.color)}`;
    })
    .join(", ");
}

// ---------- CSS generation ----------

export const CSS_PREFIX = "fc";
const cssVar = (name: string) => `--${CSS_PREFIX}-${name}`;
const kebab = (path: string) => path.split(".").join("-");

/** Maps semantic paths (relative to `semantic.<theme>`) to Tailwind color utility names. */
export const SEMANTIC_UTILITIES: Readonly<Record<string, string>> = {
  "bg.app": "app",
  "bg.surface": "surface",
  "text.primary": "fg",
  "text.secondary": "fg-muted",
  "text.link": "link",
  "border.subtle": "subtle",
  "border.control": "control",
  "focus.ring": "focus",
  "action.primary.bg-pressed": "primary-pressed",
  "action.danger.bg": "danger",
  "action.danger.text": "danger-foreground",
  "status.success.text": "success",
  "status.success.fill": "success-fill",
  "status.warning.text": "warning",
  "status.warning.fill": "warning-fill",
  "status.error.text": "error",
  "status.error.fill": "error-fill",
  "accent.highlight": "highlight",
  "accent.on-highlight": "highlight-foreground",
};

/** shadcn/ui variable contract mapped to Forgecy semantic tokens. */
export const SHADCN_MAPPING: Readonly<Record<string, string>> = {
  background: "bg.app",
  foreground: "text.primary",
  card: "bg.surface",
  "card-foreground": "text.primary",
  popover: "bg.surface",
  "popover-foreground": "text.primary",
  primary: "action.primary.bg",
  "primary-foreground": "action.primary.text",
  secondary: "bg.surface",
  "secondary-foreground": "text.primary",
  muted: "bg.app",
  "muted-foreground": "text.secondary",
  accent: "bg.app",
  "accent-foreground": "text.primary",
  destructive: "action.danger.bg",
  "destructive-foreground": "action.danger.text",
  border: "border.subtle",
  input: "border.control",
  ring: "focus.ring",
};

/** CSS custom property name (`--fc-*`) for a token path. */
export function tokenCssVar(path: string): string {
  const semantic = /^semantic\.(?:light|dark)\.(.+)$/.exec(path);
  if (semantic?.[1]) return cssVar(kebab(semantic[1]));
  if (path.startsWith("font.family.")) return cssVar(`font-${path.slice("font.family.".length)}`);
  if (path.startsWith("font.scale.")) return cssVar(`text-${path.slice("font.scale.".length)}`);
  return cssVar(kebab(path));
}

type Decl = [name: string, value: string];

/** CSS value for a token; aliases to other tokens become `var()` references. */
function tokenDecls(tokens: Map<string, FlatToken>, token: FlatToken): Decl[] {
  const name = tokenCssVar(token.path);
  if (isAlias(token.value)) return [[name, `var(${tokenCssVar(aliasTarget(token.value))})`]];
  const type = resolveType(tokens, token.path);
  const value = resolveValue(tokens, token.path);
  switch (type) {
    case "color":
      return [[name, formatColor(value as DtcgColor | string)]];
    case "dimension":
    case "duration":
      return [[name, formatDimension(value as DtcgDimension)]];
    case "fontFamily":
      return [[name, formatFontFamily(value as string | string[])]];
    case "fontWeight":
    case "number":
      return [[name, String(value)]];
    case "cubicBezier":
      return [[name, `cubic-bezier(${(value as number[]).join(", ")})`]];
    case "shadow":
      return [[name, formatShadow(value)]];
    case "typography": {
      const raw = token.value as { fontFamily: unknown };
      const t = value as {
        fontSize: DtcgDimension;
        lineHeight: number;
        fontWeight: number;
        letterSpacing: DtcgDimension;
      };
      const family = isAlias(raw.fontFamily)
        ? `var(${tokenCssVar(aliasTarget(raw.fontFamily))})`
        : formatFontFamily((value as { fontFamily: string[] }).fontFamily);
      const em =
        t.letterSpacing.unit === "px" ? round(t.letterSpacing.value / t.fontSize.value, 3) : 0;
      return [
        [`${name}-family`, family],
        [`${name}-size`, formatDimension(t.fontSize, "rem")],
        [`${name}-line-height`, String(t.lineHeight)],
        [`${name}-weight`, String(t.fontWeight)],
        [`${name}-letter-spacing`, em === 0 ? "0" : `${em}em`],
      ];
    }
    default:
      throw new Error(`Unsupported token type "${String(type)}" at ${token.path}`);
  }
}

const block = (selector: string, decls: Decl[], comment?: string) =>
  `${comment ? `/* ${comment} */\n` : ""}${selector} {\n${decls.map(([n, v]) => `  ${n}: ${v};`).join("\n")}\n}\n`;

/** Builds the full tokens.css: CSS variables per theme, shadcn mapping and the Tailwind 4 `@theme inline` block. */
export function buildTokensCss(tree: TokenTree): string {
  const tokens = flattenTokens(tree);
  const all = [...tokens.values()];
  for (const t of all) resolveValue(tokens, t.path); // fail fast on broken aliases

  const base = all.filter((t) => !t.path.startsWith("semantic."));
  const themed = (theme: Theme) => all.filter((t) => t.path.startsWith(`semantic.${theme}.`));
  const light = themed("light");
  const dark = themed("dark");

  const lightNames = light.map((t) => tokenCssVar(t.path)).sort();
  const darkNames = dark.map((t) => tokenCssVar(t.path)).sort();
  if (lightNames.join() !== darkNames.join())
    throw new Error("Light and dark semantic token sets differ");

  const semanticVar = (rel: string) => {
    const p = `semantic.light.${rel}`;
    if (!tokens.has(p)) throw new Error(`Mapping references unknown semantic token: ${rel}`);
    return `var(${tokenCssVar(p)})`;
  };

  const themeDecls: Decl[] = [
    ["--color-*", "initial"],
    ...Object.entries(SEMANTIC_UTILITIES).map(([rel, util]): Decl => [
      `--color-${util}`,
      semanticVar(rel),
    ]),
    ...Object.keys(SHADCN_MAPPING).map((n): Decl => [`--color-${n}`, `var(--${n})`]),
    ["--color-transparent", "transparent"],
    ["--color-current", "currentcolor"],
    ["--font-sans", `var(${cssVar("font-body")})`],
    ["--font-body", `var(${cssVar("font-body")})`],
    ["--font-display", `var(${cssVar("font-display")})`],
    ["--font-mono", `var(${cssVar("font-mono")})`],
    ["--text-*", "initial"],
    ...all
      .filter((t) => t.path.startsWith("font.scale."))
      .flatMap((t): Decl[] => {
        const n = t.path.slice("font.scale.".length);
        const v = tokenCssVar(t.path);
        return [
          [`--text-${n}`, `var(${v}-size)`],
          [`--text-${n}--line-height`, `var(${v}-line-height)`],
          [`--text-${n}--letter-spacing`, `var(${v}-letter-spacing)`],
          [`--text-${n}--font-weight`, `var(${v}-weight)`],
        ];
      }),
    ...all
      .filter((t) => t.path.startsWith("radius."))
      .map((t): Decl => [`--radius-${t.path.slice(7)}`, `var(${tokenCssVar(t.path)})`]),
    ...all
      .filter((t) => t.path.startsWith("shadow."))
      .map((t): Decl => [`--shadow-${t.path.slice(7)}`, `var(${tokenCssVar(t.path)})`]),
    ["--ease-standard", `var(${cssVar("motion-easing")})`],
    ["--default-transition-duration", `var(${cssVar("motion-fast")})`],
    ["--default-transition-timing-function", `var(${cssVar("motion-easing")})`],
  ];

  return [
    "/* Generated by scripts/build-tokens.ts from tokens/forgecy.tokens.json. Do not edit: run `pnpm tokens`. */\n",
    block(
      ":root",
      base.flatMap((t) => tokenDecls(tokens, t)),
      "Reference palette, typography, radius, space, line, shadow, motion",
    ),
    block(
      ':root,\n[data-theme="light"]',
      [["color-scheme", "light"], ...light.flatMap((t) => tokenDecls(tokens, t))],
      "Semantic tokens: light theme (MVP)",
    ),
    block(
      '[data-theme="dark"]',
      [["color-scheme", "dark"], ...dark.flatMap((t) => tokenDecls(tokens, t))],
      "Semantic tokens: dark theme (v1)",
    ),
    "/* No theme chosen: follow the operating system */\n@media (prefers-color-scheme: dark) {\n" +
      block(":root:not([data-theme])", [
        ["color-scheme", "dark"],
        ...dark.flatMap((t) => tokenDecls(tokens, t)),
      ])
        .replace(/^/gm, "  ")
        .replace(/ +$/gm, "") +
      "}\n",
    block(
      ":root,\n[data-theme]",
      [
        ...Object.entries(SHADCN_MAPPING).map(([n, rel]): Decl => [`--${n}`, semanticVar(rel)]),
        ["--radius", `var(${cssVar("radius-md")})`],
      ],
      "shadcn/ui contract, re-evaluated inside every themed subtree",
    ),
    block(
      "@theme inline",
      themeDecls,
      "Tailwind CSS 4 utilities: semantic tokens only (default palette and text scale removed)",
    ),
  ].join("\n");
}

// ---------- WCAG 2.2 contrast ----------

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.2 relative luminance of an sRGB color. */
export function relativeLuminance(color: string | DtcgColor): number {
  const [r, g, b] = hexToRgb(colorToHex(color)).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio (1..21) between two opaque colors. Order does not matter. */
export function checkContrast(
  foreground: string | DtcgColor,
  background: string | DtcgColor,
): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const WCAG = { text: 4.5, largeText: 3, nonText: 3 } as const;

/** Formats a ratio for display, e.g. `5.2:1`. Gates must compare the raw value, never this string. */
export const formatRatio = (ratio: number) => `${ratio.toFixed(1)}:1`;

/** Hex of a color token, aliases resolved. */
export function tokenHex(tree: TokenTree | Map<string, FlatToken>, path: string): string {
  const tokens = tree instanceof Map ? tree : flattenTokens(tree);
  return colorToHex(resolveValue(tokens, path) as DtcgColor | string);
}

export interface ContrastPair {
  fg: string;
  bg: string;
  min: number;
  label: string;
}

const surfaces = ["bg.app", "bg.surface"] as const;
const textOnSurfaces = (fg: string, label: string): ContrastPair[] =>
  surfaces.map((bg) => ({
    fg,
    bg,
    min: WCAG.text,
    label: `${label} on ${bg === "bg.app" ? "app background" : "surface"}`,
  }));
const nonTextOnSurfaces = (fg: string, label: string): ContrastPair[] =>
  surfaces.map((bg) => ({
    fg,
    bg,
    min: WCAG.nonText,
    label: `${label} on ${bg === "bg.app" ? "app background" : "surface"}`,
  }));

/** Brand Guard: semantic pairs that must pass in every theme (paths relative to `semantic.<theme>`). */
export const BRAND_GUARD_PAIRS: readonly ContrastPair[] = [
  ...textOnSurfaces("text.primary", "Primary text"),
  ...textOnSurfaces("text.secondary", "Secondary text"),
  ...textOnSurfaces("text.link", "Link"),
  ...textOnSurfaces("status.success.text", "Success text"),
  ...textOnSurfaces("status.warning.text", "Warning text"),
  ...textOnSurfaces("status.error.text", "Error text"),
  ...nonTextOnSurfaces("border.control", "Control border"),
  ...nonTextOnSurfaces("focus.ring", "Focus ring"),
  {
    fg: "action.primary.text",
    bg: "action.primary.bg",
    min: WCAG.text,
    label: "Primary button",
  },
  {
    fg: "action.primary.text",
    bg: "action.primary.bg-pressed",
    min: WCAG.text,
    label: "Primary button pressed",
  },
  {
    fg: "action.danger.text",
    bg: "action.danger.bg",
    min: WCAG.text,
    label: "Destructive button",
  },
  {
    fg: "accent.on-highlight",
    bg: "accent.highlight",
    min: WCAG.text,
    label: "Text on highlight",
  },
];

export interface ContrastResult extends ContrastPair {
  theme: Theme;
  fgHex: string;
  bgHex: string;
  ratio: number;
  pass: boolean;
}

/** Evaluates every Brand Guard pair for the given themes. */
export function evaluateBrandGuard(
  tree: TokenTree,
  themes: readonly Theme[] = ["light", "dark"],
): ContrastResult[] {
  const tokens = flattenTokens(tree);
  return themes.flatMap((theme) =>
    BRAND_GUARD_PAIRS.map((pair) => {
      const fgHex = tokenHex(tokens, `semantic.${theme}.${pair.fg}`);
      const bgHex = tokenHex(tokens, `semantic.${theme}.${pair.bg}`);
      const ratio = checkContrast(fgHex, bgHex);
      return { ...pair, theme, fgHex, bgHex, ratio, pass: ratio >= pair.min };
    }),
  );
}
