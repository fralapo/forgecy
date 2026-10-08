import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";

/**
 * Addresses a server-side fetch must never reach. Classified on parsed bytes by
 * node:net's BlockList, not on string prefixes: BlockList also unwraps IPv4-mapped IPv6
 * (::ffff:a9fe:a9fe == 169.254.169.254) against the IPv4 rules. Transition ranges that
 * embed an IPv4 address (NAT64, 6to4, Teredo, SIIT, IPv4-compatible) are denied whole.
 * Ceiling: an IPv6-only NAT64/DNS64 network resolves public sites into 64:ff9b::/96 and
 * would be blocked; such installs set FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS=true.
 */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
const BLOCKED_V6: Array<[string, number]> = [
  ["::", 96], // unspecified, loopback and IPv4-compatible
  ["::ffff:0:0:0", 96], // SIIT (IPv4-translated)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo
  ["2001:10::", 28], // ORCHID
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["3fff::", 20], // documentation
  ["5f00::", 16], // SRv6 SIDs
  ["fc00::", 7], // unique local (AWS IMDS v6 lives here)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated, still routed by some stacks)
  ["ff00::", 8], // multicast
];
const blocked = new BlockList();
for (const [base, bits] of BLOCKED_V4) blocked.addSubnet(base, bits, "ipv4");
for (const [base, bits] of BLOCKED_V6) blocked.addSubnet(base, bits, "ipv6");

/** Loopback, private, link-local, CGNAT, multicast, reserved and transition ranges (v4 and v6). */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const version = isIP(bare);
  // Not a canonical IP ("012.0.0.1" is octal to the OS, "1.2.3" is shorthand): fail closed.
  if (version === 0) return true;
  return blocked.check(bare, version === 4 ? "ipv4" : "ipv6");
}

export type HostCheck = (url: string) => Promise<boolean>;

const HOST_CHECK_TTL_MS = 60_000;
const HOST_CHECK_MAX_ENTRIES = 1000;

const isLocalName = (host: string) =>
  host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local");

/**
 * The crawler runs on the agency machine: by default it refuses hosts that resolve
 * to the local network, so a typed URL cannot reach the router, NAS or Forgecy
 * itself. FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS=true lifts it (e.g. intranet sites).
 * Answers are cached for `ttlMs` (a long-lived worker would otherwise trust a DNS
 * answer forever); a failed lookup is never cached.
 */
export function createHostCheck(
  options: { allowPrivate?: boolean; ttlMs?: number; now?: () => number } = {},
): HostCheck {
  const ttl = options.ttlMs ?? HOST_CHECK_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { ok: boolean; until: number }>();
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
    if (cached && cached.until > now()) return cached.ok;
    let ok: boolean;
    if (isIP(host)) ok = !isPrivateAddress(host);
    else if (isLocalName(host)) ok = false;
    else {
      try {
        const addresses = await lookup(host, { all: true });
        ok = addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
      } catch {
        // Unresolvable: let the fetch fail with a clear "unreachable" instead (not cached).
        return true;
      }
    }
    if (cache.size >= HOST_CHECK_MAX_ENTRIES) cache.clear();
    cache.set(host, { ok, until: now() + ttl });
    return ok;
  };
}

export type PublicAddress =
  { ok: true; address: string } | { ok: false; reason: "private" | "unresolved" };

/** One validated address for `hostname`, or why there is none (so callers can fail closed with the right error). */
export async function resolvePublicAddress(hostname: string): Promise<PublicAddress> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host))
    return isPrivateAddress(host) ? { ok: false, reason: "private" } : { ok: true, address: host };
  if (isLocalName(host)) return { ok: false, reason: "private" };
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return { ok: false, reason: "unresolved" };
    if (addresses.some((a) => isPrivateAddress(a.address))) return { ok: false, reason: "private" };
    return { ok: true, address: addresses[0]!.address };
  } catch {
    return { ok: false, reason: "unresolved" };
  }
}

/**
 * One resolved, validated address for `hostname`, to pin a single connection to it
 * (Chromium's --host-resolver-rules). Null when the host is disallowed, unresolvable,
 * or allowPrivate is set (no pinning). Callers that must fail closed use
 * resolvePublicAddress to tell those cases apart.
 */
export async function resolvePinnedAddress(
  hostname: string,
  options: { allowPrivate?: boolean } = {},
): Promise<string | null> {
  if (options.allowPrivate) return null;
  const result = await resolvePublicAddress(hostname);
  return result.ok ? result.address : null;
}

/**
 * fetch() whose DNS resolution is validated at the moment undici actually connects.
 * (Moved unchanged from audit/url.ts; fixed in the next task.)
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
    fetch(input, { ...init, dispatcher: agent } as unknown as Parameters<
      typeof fetch
    >[1])) as typeof fetch;
}
