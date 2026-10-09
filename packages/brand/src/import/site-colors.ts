/**
 * What a site really declares, from its stored probe: the colors and fonts that are offered to the
 * analyst, proposed directly, and used by the gate to refuse anything else. Pure.
 */
import type { SiteProbe } from "@forgecy/audit";
import { englishMessage } from "@forgecy/i18n";
import { isFrameworkDefaultHex, isGenericFont } from "./verify";

/** A CSS variable with one of these words in its name is the brand's own choice, even over a framework hex. */
const BRAND_VAR = /primary|secondary|brand|accent|main/i;

/** Evidence locators of what the site's styles gave: English text of an i18n key, translated when shown. */
export const SITE_LOCATORS = {
  styles: englishMessage("brand.import.locators.siteStyles"),
  fonts: englishMessage("brand.import.locators.siteFonts"),
  buttons: englishMessage("brand.import.locators.siteButtons"),
  themeColor: englishMessage("brand.import.locators.siteThemeColor"),
} as const;

export interface KnownColor {
  hex: string;
  /** Token slug: the variable name without `--`, `color-`, `brand-`, or "theme"/"button" for the other sources. */
  name: string;
  /** Where it was read, shown as the proposal's evidence. */
  locator: string;
}

export const cleanFamily = (family: string) =>
  family
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

/** Every opaque color the probe holds, lowercase #rrggbb. */
export function extractedHexes(visual: SiteProbe | undefined): Set<string> {
  const out = new Set<string>();
  if (!visual) return out;
  for (const v of visual.cssVars) out.add(v.hex.toLowerCase());
  if (visual.themeColor) out.add(visual.themeColor.toLowerCase());
  for (const b of visual.buttonColors) out.add(b.hex.toLowerCase());
  return out;
}

/** True for a CSS-framework default palette color the site did not declare as its brand variable. */
export function isFrameworkColor(hex: string, visual: SiteProbe | undefined): boolean {
  if (!isFrameworkDefaultHex(hex)) return false;
  const h = hex.toLowerCase();
  return !visual?.cssVars.some((v) => v.hex.toLowerCase() === h && BRAND_VAR.test(v.name));
}

/**
 * Brand colors in order of trust: CSS variables (brand-named first), `theme-color`, then
 * button/link/header colors by weight. Exact duplicates and framework defaults are left out.
 */
export function knownColors(visual: SiteProbe): KnownColor[] {
  const out: KnownColor[] = [];
  const seen = new Set<string>();
  const add = (hex: string, name: string, locator: string) => {
    const h = hex.toLowerCase();
    if (seen.has(h) || isFrameworkColor(h, visual)) return;
    seen.add(h);
    out.push({ hex: h, name, locator });
  };
  const vars = [...visual.cssVars].sort(
    (a, b) => Number(BRAND_VAR.test(b.name)) - Number(BRAND_VAR.test(a.name)),
  );
  for (const v of vars)
    add(v.hex, v.name.replace(/^--/, "").replace(/^(?:color-|brand-)+/, "") || v.name, v.name);
  if (visual.themeColor) add(visual.themeColor, "theme", SITE_LOCATORS.themeColor);
  for (const b of [...visual.buttonColors].sort((a, c) => c.weight - a.weight))
    add(b.hex, b.role === "bg" ? "button" : "button-text", SITE_LOCATORS.buttons);
  return out;
}

/** Fonts worth proposing: loaded by the page, or not a system/generic family. */
export function knownFonts(visual: SiteProbe): SiteProbe["fonts"] {
  return visual.fonts.filter((f) => f.loaded || !isGenericFont(f.family));
}
