import { load } from "cheerio";

export type WebsiteBrandIdentity = {
  logoUrl: string | null;
  palette: { primary: string | null; secondary: string | null; accent: string | null; background: string | null };
  fontFamily: string | null;
};

function sameHostUrl(value: string | undefined, base: URL) {
  if (!value) return "";
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.hostname !== base.hostname || (url.port && url.port !== "443")) return "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

export function websiteStylesheetUrls(rawUrl: string, html: string, limit = 4) {
  const base = new URL(rawUrl);
  const $ = load(html);
  const urls = new Set<string>();
  $("link[rel~='stylesheet'][href]").each((_, element) => {
    const url = sameHostUrl($(element).attr("href"), base);
    if (url && /\.css(?:$|\?)/i.test(url)) urls.add(url);
  });
  return [...urls].slice(0, Math.max(0, Math.min(6, limit)));
}

function colorHex(value: string) {
  const token = value.trim().toLowerCase();
  const hex = token.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    return "#" + (raw.length === 3 ? raw.split("").map(ch => ch + ch).join("") : raw);
  }
  const rgb = token.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/);
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some(channel => channel > 255)) return null;
  return "#" + channels.map(channel => channel.toString(16).padStart(2, "0")).join("");
}

function isUsefulColor(hex: string) {
  if (["#000000", "#ffffff", "#fffafa", "#f5f5f5", "#eeeeee", "#f0f0f0", "#333333", "#666666"].includes(hex)) return false;
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max - min > 14 || (max > 75 && max < 220);
}

function colorTokens(text: string) {
  return [...text.matchAll(/#[\da-f]{3}(?:[\da-f]{3})?\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[\d.]+)?\s*\)/gi)]
    .map(match => colorHex(match[0])).filter((value): value is string => Boolean(value) && isUsefulColor(value!));
}

function logoScore(url: string, label: string) {
  const value = (url + " " + label).toLowerCase();
  let score = 0;
  if (/logo|logotype|marchio/.test(value)) score += 5;
  if (/site-logo|custom-logo|brand-logo/.test(value)) score += 5;
  if (/deodue|brand|azienda/.test(value)) score += 2;
  if (/icon|favicon|apple-touch|150x150|32x32|16x16/.test(value)) score -= 5;
  return score;
}

export function extractWebsiteBrand(rawUrl: string, html: string, stylesheets: string[] = []): WebsiteBrandIdentity {
  const base = new URL(rawUrl);
  const $ = load(html);
  const titleBrand = $("title").first().text().split(/[|–—-]/)[0].trim();
  const siteName = titleBrand || ($("meta[property='og:site_name']").attr("content") || $("meta[name='application-name']").attr("content") || "").split(/[|–—-]/)[0].trim();
  const siteNameToken = siteName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const logoCandidates = new Map<string, { score: number; order: number }>();
  let order = 0;
  const addLogo = (raw: string | undefined, label: string, bonus = 0) => {
    const url = sameHostUrl(raw, base);
    if (!url) return;
    const identity = (new URL(url).pathname + " " + label).toLowerCase().replace(/[^a-z0-9]/g, "");
    const matchesSiteName = siteNameToken.length > 2 && identity.includes(siteNameToken);
    const score = logoScore(url, label) + bonus + (matchesSiteName ? 12 : siteNameToken.length > 2 ? -3 : 0);
    const old = logoCandidates.get(url);
    if (!old || score > old.score) logoCandidates.set(url, { score, order: order++ });
  };
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const parsed = JSON.parse($(element).contents().text()) as unknown;
      const pending = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (pending.length) {
        const item = pending.shift();
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const types = Array.isArray(row["@type"]) ? row["@type"] : [row["@type"]];
        if (types.some(type => /organization|localbusiness/i.test(String(type)))) {
          const logo = row.logo;
          addLogo(typeof logo === "string" ? logo : logo && typeof logo === "object" ? String((logo as Record<string, unknown>).url || "") : undefined, "structured organization logo", 4);
        }
        for (const key of ["@graph", "itemListElement"]) if (Array.isArray(row[key])) pending.push(...row[key] as unknown[]);
      }
    } catch { /* invalid structured metadata is ignored */ }
  });
  $("img").each((_, element) => {
    const image = $(element);
    const src = image.attr("src") || image.attr("data-src") || image.attr("data-lazy-src");
    const label = [image.attr("alt"), image.attr("class"), image.attr("id"), image.parent().attr("class")].filter(Boolean).join(" ");
    addLogo(src, label);
  });
  $("link[rel~='icon'][href],link[rel='apple-touch-icon'][href]").each((_, element) => addLogo($(element).attr("href"), "favicon"));
  const logo = [...logoCandidates.entries()].sort((a, b) => b[1].score - a[1].score || a[1].order - b[1].order)[0];

  const css = [$("style").text(), $("[style]").map((_, element) => $(element).attr("style") || "").get().join("\n"), ...stylesheets].join("\n");
  const variables = [...css.matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{3}(?:[\da-f]{3})?|rgba?\([^;{}]+\))/gi)]
    .flatMap(match => {
      const color = colorHex(match[2]);
      return color && isUsefulColor(color) ? [{ name: match[1].toLowerCase(), color }] : [];
    });
  const namedColor = (pattern: RegExp) => variables.find(variable => pattern.test(variable.name))?.color || null;
  const theme = colorHex($("meta[name='theme-color']").attr("content") || "");
  const counts = new Map<string, number>();
  for (const color of colorTokens(css)) counts.set(color, (counts.get(color) || 0) + 1);
  const frequent = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  const primary = namedColor(/(?:brand|primary|main|theme).*(?:color)?|(?:color|theme)-(?:primary|brand)|--ast-global-color-0/)
    || (theme && isUsefulColor(theme) ? theme : null) || frequent[0] || null;
  const otherColors = frequent.filter(color => color !== primary);
  const secondary = namedColor(/secondary|support/) || otherColors[0] || null;
  const accent = namedColor(/accent|highlight|tertiary/) || otherColors.find(color => color !== secondary) || null;
  const background = namedColor(/background|surface/) || null;
  let fontValue = css.match(/(?:--[\w-]*font[\w-]*|font-family)\s*:\s*([^;{}]{2,140})/i)?.[1]?.trim() || "";
  const fontVariable = fontValue.match(/^var\(\s*(--[\w-]+)\s*\)/i)?.[1];
  if (fontVariable) fontValue = css.match(new RegExp(fontVariable + "\\s*:\\s*([^;{}]{2,140})", "i"))?.[1]?.trim() || "";
  const font = fontValue.split(",")[0].trim().replace(/^['"]|['"]$/g, "") || null;
  return { logoUrl: logo && logo[1].score > 0 ? logo[0] : null, palette: { primary, secondary, accent, background }, fontFamily: font };
}
