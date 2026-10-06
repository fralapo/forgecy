/**
 * Global search: what can be searched, how the query string is read and how a
 * match is highlighted. Pure functions shared by the page and its loader.
 */

/** Result groups, in the order the page shows them. */
export const searchTypes = [
  "client",
  "carousel",
  "product",
  "brand",
  "audit",
  "report",
  "template",
  "asset",
] as const;
export type SearchType = (typeof searchTypes)[number];

export const MIN_QUERY = 2;
export const GROUP_LIMIT = 5;
export const FULL_LIMIT = 50;

export interface SearchParams {
  q: string;
  types: SearchType[];
  client: string | null;
  archived: boolean;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** `?q=&type=carousel,product&client=slug&archived=1`; unknown types are dropped. */
export function parseSearchParams(sp: Record<string, string | string[] | undefined>): SearchParams {
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  // Both `type=a,b` (links) and `type=a&type=b` (the filter checkboxes).
  const rawTypes = [sp.type ?? []].flat().flatMap((v) => v.split(","));
  const types = searchTypes.filter((t) => rawTypes.includes(t));
  const client = first(sp.client)?.trim() || null;
  return { q, types, client, archived: first(sp.archived) === "1" };
}

/** Query string for a search, keeping only what is set. */
export function searchHref(p: Partial<SearchParams>): string {
  const u = new URLSearchParams();
  if (p.q) u.set("q", p.q);
  if (p.types?.length) u.set("type", p.types.join(","));
  if (p.client) u.set("client", p.client);
  if (p.archived) u.set("archived", "1");
  const s = u.toString();
  return s ? `/search?${s}` : "/search";
}

/** `%q%` for ILIKE with the user's `%`, `_` and `\` taken literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Splits `text` into parts, marking the case-insensitive matches of `q`. */
export function highlight(text: string, q: string): Array<{ text: string; match: boolean }> {
  if (!q) return [{ text, match: false }];
  const parts: Array<{ text: string; match: boolean }> = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let from = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, from)) {
    if (i > from) parts.push({ text: text.slice(from, i), match: false });
    parts.push({ text: text.slice(i, i + needle.length), match: true });
    from = i + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
