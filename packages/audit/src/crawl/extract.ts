import type { ScanExtraction } from "@forgecy/db";
import { socialChannelOf } from "../url";
import type { FetchedPage } from "./fetcher";

const round = (n: number) => Math.round(n * 1000) / 1000;

function topShares<T extends { weight: number }>(items: T[], limit: number) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total <= 0) return [];
  return items
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((i) => ({ ...i, share: round(i.weight / total) }));
}

/**
 * Site-wide observed elements from the pages read: dominant colors and fonts
 * (browser only), CTAs with the pages they appear on, social links, contact form.
 */
export function aggregateExtraction(pages: FetchedPage[]): ScanExtraction {
  const colorWeights = new Map<string, number>();
  const fontWeights = new Map<string, { family: string; roles: Set<string>; weight: number }>();
  const ctas = new Map<string, Set<string>>();
  const social = new Map<string, string>();
  let contactForm = false;

  for (const page of pages) {
    // Each page counts the same, whatever its length.
    const pageColorTotal = page.colors.reduce((s, c) => s + c.weight, 0) || 1;
    for (const c of page.colors) {
      const hex = c.hex.toLowerCase();
      colorWeights.set(hex, (colorWeights.get(hex) ?? 0) + c.weight / pageColorTotal);
    }
    for (const f of page.fonts) {
      const key = f.family.toLowerCase();
      const entry = fontWeights.get(key) ?? { family: f.family, roles: new Set(), weight: 0 };
      entry.roles.add(f.role);
      entry.weight += f.weight;
      fontWeights.set(key, entry);
    }
    const path = new URL(page.finalUrl).pathname || "/";
    for (const text of page.data.ctas ?? []) {
      const key = text.trim();
      const set = ctas.get(key) ?? new Set<string>();
      set.add(path);
      ctas.set(key, set);
    }
    for (const link of page.links) {
      const channel = socialChannelOf(link);
      if (channel && !social.has(channel)) social.set(channel, link);
    }
    contactForm ||= page.data.contactForm === true;
  }

  const colors = topShares(
    [...colorWeights].map(([hex, weight]) => ({ hex, weight })),
    8,
  ).map(({ hex, share }) => ({ hex, share }));
  const fonts = topShares([...fontWeights.values()], 4).map((f) => ({
    family: f.family,
    usage: (f.roles.size > 1 ? "both" : [...f.roles][0]) as "headings" | "body" | "both",
    share: f.share,
  }));
  return {
    ...(colors.length ? { colors } : {}),
    ...(fonts.length ? { fonts } : {}),
    ctas: [...ctas]
      .map(([text, set]) => ({ text, pages: [...set] }))
      .sort((a, b) => b.pages.length - a.pages.length)
      .slice(0, 15),
    socialLinks: [...social].map(([channel, url]) => ({ channel, url })),
    contactForm,
  };
}

export interface TechnicalCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  pages: string[];
}

/**
 * Accessibility and performance checks computed without AI (they also run under
 * the no_ai policy). Each failed check can become a technical evidence.
 */
export function technicalChecks(pages: FetchedPage[]): TechnicalCheck[] {
  const pathOf = (p: FetchedPage) => new URL(p.finalUrl).pathname || "/";
  const checks: TechnicalCheck[] = [];
  const noH1 = pages.filter((p) => (p.data.h1?.length ?? 0) === 0);
  checks.push({
    key: "h1",
    label: "Un titolo H1 per pagina",
    ok: noH1.length === 0,
    detail: noH1.length ? `${noH1.length} pagine senza H1` : "Tutte le pagine hanno un H1",
    pages: noH1.map(pathOf),
  });
  const multiH1 = pages.filter((p) => (p.data.h1?.length ?? 0) > 1);
  checks.push({
    key: "multiple_h1",
    label: "Un solo H1",
    ok: multiH1.length === 0,
    detail: multiH1.length ? `${multiH1.length} pagine con più H1` : "Nessuna pagina con più H1",
    pages: multiH1.map(pathOf),
  });
  const noMeta = pages.filter((p) => !p.data.metaDescription);
  checks.push({
    key: "meta_description",
    label: "Meta description",
    ok: noMeta.length === 0,
    detail: noMeta.length ? `${noMeta.length} pagine senza meta description` : "Presente ovunque",
    pages: noMeta.map(pathOf),
  });
  const alt = pages.reduce(
    (acc, p) => ({
      missing: acc.missing + (p.data.imagesWithoutAlt ?? 0),
      total: acc.total + (p.data.imagesTotal ?? 0),
    }),
    { missing: 0, total: 0 },
  );
  checks.push({
    key: "img_alt",
    label: "Testo alternativo delle immagini",
    ok: alt.missing === 0,
    detail: `${alt.missing} immagini su ${alt.total} senza attributo alt`,
    pages: pages.filter((p) => (p.data.imagesWithoutAlt ?? 0) > 0).map(pathOf),
  });
  const noLang = pages.filter((p) => !p.data.lang);
  checks.push({
    key: "lang",
    label: "Lingua della pagina dichiarata",
    ok: noLang.length === 0,
    detail: noLang.length ? `${noLang.length} pagine senza attributo lang` : "Dichiarata ovunque",
    pages: noLang.map(pathOf),
  });
  const noViewport = pages.filter((p) => p.data.hasViewport === false);
  checks.push({
    key: "viewport",
    label: "Pagine adatte al mobile (meta viewport)",
    ok: noViewport.length === 0,
    detail: noViewport.length ? `${noViewport.length} pagine senza meta viewport` : "Presente",
    pages: noViewport.map(pathOf),
  });
  const slow = pages.filter((p) => (p.data.loadMs ?? 0) > 4000);
  checks.push({
    key: "load_time",
    label: "Caricamento sotto 4 secondi",
    ok: slow.length === 0,
    detail: slow.length
      ? `${slow.length} pagine oltre 4 s (misurato dal server di Forgecy)`
      : "Tutte sotto 4 s (misurato dal server di Forgecy)",
    pages: slow.map(pathOf),
  });
  return checks;
}
