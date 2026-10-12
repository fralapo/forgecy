import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "@forgecy/core";

/**
 * Region used by Intl for dates and numbers. English follows British conventions
 * (6 Oct 2026, 24-hour clock) like the rest of the agency's documents.
 */
const INTL_LOCALE: Record<Locale, string> = {
  en: "en-GB",
  it: "it-IT",
};

export function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale];
}

/**
 * Best supported language for an Accept-Language header ("it-IT,it;q=0.9,en;q=0.8"),
 * matching on the primary subtag; English when nothing matches.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((r) => r.tag && r.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

export { DEFAULT_LOCALE, isLocale, LOCALES, type Locale };
