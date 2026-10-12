const BASE = "http://forgecy.invalid";
const MAX_LENGTH = 2048;

/**
 * Post-login destination from the `next` query parameter. Resolves it the way a browser would
 * (backslashes and tabs included) and accepts it only if it stays on this origin; `/\evil.com`
 * and `/<TAB>/evil.com` both resolve to `//evil.com`, which a prefix check misses. Returns a
 * same-origin path (query and hash kept), or `/` for anything else.
 */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length > MAX_LENGTH || !next.startsWith("/")) return "/";
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return "/";
    const path = url.pathname + url.search + url.hash;
    // Dot segments can collapse `/..//evil.com` to `//evil.com`, which a browser reads as another host.
    return path.startsWith("//") ? "/" : path;
  } catch {
    return "/";
  }
}
