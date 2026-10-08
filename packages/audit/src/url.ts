import { isIP } from "node:net";
import type { SocialChannel } from "@forgecy/core";

export {
  createHostCheck,
  createPinnedFetch,
  isPrivateAddress,
  resolvePinnedAddress,
  resolvePublicAddress,
  type HostCheck,
  type PublicAddress,
} from "@forgecy/core/net-guard";

/**
 * Normalize what a person types into a site URL: adds https://, drops the hash,
 * lowercases the host. Returns null when it cannot be an http(s) URL.
 */
export function normalizeSiteUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".") && url.hostname !== "localhost" && !isIP(url.hostname))
    return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

/** Registrable-ish domain used for duplicate checks: host without "www.". */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Same site for crawling purposes: same host, ignoring a leading "www.". */
export function sameSite(a: string, b: string): boolean {
  const da = domainOf(a);
  return da !== null && da === domainOf(b);
}

const PLATFORM_HOSTS: Record<SocialChannel, RegExp> = {
  instagram: /(^|\.)instagram\.com$/,
  facebook: /(^|\.)(facebook\.com|fb\.com)$/,
  linkedin: /(^|\.)linkedin\.com$/,
  tiktok: /(^|\.)tiktok\.com$/,
};

/** True when `url` is a profile on the given platform (domain check only, no fetch). */
export function isPlatformUrl(channel: SocialChannel, url: string): boolean {
  const normalized = normalizeSiteUrl(url);
  if (!normalized) return false;
  return PLATFORM_HOSTS[channel].test(new URL(normalized).hostname.toLowerCase());
}

/** Which social channel a link points to, if any (used for "Social presence"). */
export function socialChannelOf(url: string): SocialChannel | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [channel, re] of Object.entries(PLATFORM_HOSTS) as Array<[SocialChannel, RegExp]>)
    if (re.test(host)) return channel;
  return null;
}
