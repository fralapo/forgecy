import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SocialChannel } from "@forgecy/core";
import { Agent } from "undici";

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

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** Loopback, private, link-local, CGNAT, multicast and reserved ranges (v4 and v6). */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const n = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (version === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return true;
}

export type HostCheck = (url: string) => Promise<boolean>;

/**
 * The crawler runs on the agency machine: by default it refuses hosts that resolve
 * to the local network, so a typed URL cannot reach the router, NAS or Forgecy
 * itself. FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS=true lifts it (e.g. intranet sites).
 */
export function createHostCheck(options: { allowPrivate?: boolean } = {}): HostCheck {
  const cache = new Map<string, boolean>();
  return async (url) => {
    if (options.allowPrivate) return true;
    let host: string;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      host = u.hostname.replace(/^\[|\]$/g, "");
    } catch {
      return false;
    }
    const cached = cache.get(host);
    if (cached !== undefined) return cached;
    let ok: boolean;
    if (isIP(host)) ok = !isPrivateAddress(host);
    else if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local"))
      ok = false;
    else {
      try {
        const addresses = await lookup(host, { all: true });
        ok = addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
      } catch {
        // Unresolvable: let the fetch fail with a clear "unreachable" instead.
        ok = true;
      }
    }
    cache.set(host, ok);
    return ok;
  };
}

/**
 * One resolved, validated address for `hostname`, to pin a single connection to it
 * (Chromium's --host-resolver-rules): the browser then never re-resolves this host
 * itself, closing the DNS-rebinding window between the check and the real connect.
 * Null when the host is disallowed, unresolvable, or allowPrivate is set (no pinning).
 */
export async function resolvePinnedAddress(
  hostname: string,
  options: { allowPrivate?: boolean } = {},
): Promise<string | null> {
  if (options.allowPrivate) return null;
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPrivateAddress(host) ? null : host;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) return null;
    return addresses[0]!.address;
  } catch {
    return null;
  }
}

/**
 * fetch() whose DNS resolution is validated at the moment undici actually connects,
 * instead of by a separate earlier call: createHostCheck's own lookup and the real
 * connection's lookup would otherwise be two separate DNS queries, and a rebinding
 * name server can answer safely for the first and privately for the second a moment
 * later. Here there is only one lookup, and it is the one that gates the connection.
 * allowPrivate returns the plain fetch, matching createHostCheck.
 */
export function createPinnedFetch(options: { allowPrivate?: boolean } = {}): typeof fetch {
  if (options.allowPrivate) return fetch;
  const agent = new Agent({
    connect: {
      lookup(
        hostname: string,
        lookupOptions: LookupOptions,
        callback: (
          err: NodeJS.ErrnoException | null,
          address: string | LookupAddress[],
          family?: number,
        ) => void,
      ) {
        dnsLookup(hostname, { ...lookupOptions, all: true }, (err, addresses) => {
          if (err) {
            callback(err, []);
            return;
          }
          const list = addresses as LookupAddress[];
          if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
            callback(new Error(`DNS for "${hostname}" resolves to a disallowed address`), []);
            return;
          }
          if (lookupOptions.all) {
            callback(null, list);
            return;
          }
          const chosen = list[0]!;
          callback(null, chosen.address, chosen.family);
        });
      },
    },
  });
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(input, { ...init, dispatcher: agent } as unknown as Parameters<typeof fetch>[1])) as typeof fetch;
}
