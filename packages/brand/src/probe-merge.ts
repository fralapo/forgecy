/**
 * Pure: folds the per-page SiteProbe of a crawl into one for the whole site. No DB or worker
 * imports, so it stays testable and safe to import anywhere.
 */
import { rankLogoCandidates, type FontRole, type ProbeImage, type SiteProbe } from "@forgecy/audit";

const MAX = { cssVars: 40, buttonColors: 24, fonts: 12, images: 60, logos: 8 } as const;

/** One entry per url; `repeats` counts the pages that carry it, not the uses inside a page. */
function mergeImages(lists: ProbeImage[][]): ProbeImage[] {
  const byUrl = new Map<string, ProbeImage>();
  const lastPage = new Map<string, number>();
  lists.forEach((list, page) => {
    for (const image of list) {
      const prev = byUrl.get(image.url);
      if (!prev) {
        byUrl.set(image.url, { ...image, repeats: 1 });
        lastPage.set(image.url, page);
        continue;
      }
      prev.inHeader ||= image.inHeader;
      prev.inFooter ||= image.inFooter;
      if (image.w * image.h > prev.w * prev.h) {
        prev.w = image.w;
        prev.h = image.h;
      }
      if (lastPage.get(image.url) !== page) {
        prev.repeats += 1;
        lastPage.set(image.url, page);
      }
    }
  });
  return [...byUrl.values()];
}

export function mergeProbes(probes: SiteProbe[]): SiteProbe {
  const cssVars = new Map<string, { name: string; hex: string }>();
  const buttons = new Map<string, SiteProbe["buttonColors"][number]>();
  const fonts = new Map<string, { family: string; roles: Set<FontRole>; loaded: boolean }>();
  for (const p of probes) {
    for (const v of p.cssVars) if (!cssVars.has(v.hex)) cssVars.set(v.hex, v);
    for (const b of p.buttonColors) {
      const key = `${b.hex}|${b.role}`;
      buttons.set(key, { ...b, weight: (buttons.get(key)?.weight ?? 0) + b.weight });
    }
    for (const f of p.fonts) {
      const key = f.family.toLowerCase();
      const prev = fonts.get(key);
      fonts.set(key, {
        family: prev?.family ?? f.family,
        roles: new Set([...(prev?.roles ?? []), ...f.roles]),
        loaded: (prev?.loaded ?? false) || f.loaded,
      });
    }
  }
  const themeColor = probes.find((p) => p.themeColor)?.themeColor;
  const organization = probes.find((p) => p.organization)?.organization;
  const siteName = probes.find((p) => p.siteName)?.siteName;
  return {
    cssVars: [...cssVars.values()].slice(0, MAX.cssVars),
    ...(themeColor ? { themeColor } : {}),
    buttonColors: [...buttons.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX.buttonColors),
    fonts: [...fonts.values()]
      .map((f) => ({ family: f.family, roles: [...f.roles], loaded: f.loaded }))
      .slice(0, MAX.fonts),
    logos: rankLogoCandidates(mergeImages(probes.map((p) => p.logos))).slice(0, MAX.logos),
    images: mergeImages(probes.map((p) => p.images))
      .sort((a, b) => b.w * b.h - a.w * a.h)
      .slice(0, MAX.images),
    ...(organization ? { organization } : {}),
    ...(siteName ? { siteName } : {}),
  };
}
