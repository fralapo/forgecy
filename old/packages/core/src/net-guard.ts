import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

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
 *
 * A host Node cannot resolve passes by default: the pinned fetch's own lookup then fails
 * closed. `failClosed` refuses it instead, for callers whose client resolves the name
 * itself (Chromium): a DNS server that fails Node's query but answers 192.168.1.1 to
 * Chromium's would otherwise get through.
 */
export function createHostCheck(
  options: {
    allowPrivate?: boolean;
    failClosed?: boolean;
    ttlMs?: number;
    now?: () => number;
  } = {},
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
        // A stray private record (a placeholder AAAA "::", a misconfigured ULA) next to a public
        // one must not block the host when Forgecy connects itself: the pinned fetch only ever
        // connects to a public address. A client that resolves the name on its own (failClosed:
        // Chromium for the hosts it does not pin) could fall back to the private record, so there
        // every answer has to be public.
        const isPublic = (a: { address: string }) => !isPrivateAddress(a.address);
        ok =
          addresses.length > 0 &&
          (options.failClosed ? addresses.every(isPublic) : addresses.some(isPublic));
      } catch {
        // Unresolvable: let the fetch fail with a clear "unreachable" instead (not cached),
        // unless the caller's client does its own resolution.
        return !options.failClosed;
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
    // The connection is pinned to the address returned here, so a stray private record next to a
    // public one is ignored rather than blocking the host.
    const pinned = addresses.find((a) => !isPrivateAddress(a.address));
    return pinned ? { ok: true, address: pinned.address } : { ok: false, reason: "private" };
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
 * fetch() whose DNS resolution is validated at the moment undici actually connects:
 * a separate earlier lookup (createHostCheck) and the real connection's lookup would be
 * two DNS queries, and a rebinding name server answers safely for the first and
 * privately for the second. Here the one lookup that gates the connection is the
 * lookup that makes it.
 *
 * Two traps this guards against:
 * - the Agent must be paired with undici's OWN fetch. The Node built-in fetch bundles an
 *   older undici whose handler interface differs; handing it this Agent throws
 *   "invalid onRequestStart method" on every request.
 * - net.connect never calls `lookup` for an IP-literal host, so a private literal
 *   (http://169.254.169.254/, http://[::ffff:a9fe:a9fe]/) is rejected here instead.
 * allowPrivate returns the plain fetch, matching createHostCheck.
 */
export function createPinnedFetch(options: { allowPrivate?: boolean } = {}): typeof fetch {
  if (options.allowPrivate) return fetch;
  const agent = new Agent({ connect: { lookup: pinnedLookup } });
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const literal = target.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && isPrivateAddress(literal))
      throw new TypeError(`"${literal}" is a disallowed address`);
    // `never` casts: undici's fetch types differ from lib.dom's; string/URL inputs only.
    return undiciFetch(input as never, { ...init, dispatcher: agent } as never);
  }) as typeof fetch;
}

function pinnedLookup(
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
    // Only public addresses are handed to the connection: a stray private record next to a
    // public one is never connected to, so it does not block the host.
    const safe = list.filter((a) => !isPrivateAddress(a.address));
    if (safe.length === 0) {
      callback(new Error(`DNS for "${hostname}" resolves to a disallowed address`), []);
      return;
    }
    if (lookupOptions.all) {
      callback(null, safe);
      return;
    }
    const chosen = safe[0]!;
    callback(null, chosen.address, chosen.family);
  });
}

export class GuardedFetchError extends Error {
  constructor(
    readonly reason: "blocked" | "too_many_redirects",
    readonly url: string,
  ) {
    super(
      reason === "blocked"
        ? `Request to "${url}" refused: disallowed address or scheme`
        : `Too many redirects at "${url}"`,
    );
    this.name = "GuardedFetchError";
  }
}

export interface GuardedFetchOptions {
  hostCheck: HostCheck;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  /** Redirects followed before giving up. */
  maxHops?: number;
  /** One deadline for every hop and the body read. */
  timeoutMs?: number;
}

/**
 * fetch() that validates EVERY hop. Redirects are followed by hand (redirect:"manual"):
 * the host check runs on the first URL and on each Location, so a public page cannot
 * bounce the request to the local network, and a non-http(s) Location is refused.
 * Pair `fetchImpl` with createPinnedFetch so the connect itself is validated too.
 */
export async function guardedFetch(
  url: string,
  options: GuardedFetchOptions,
): Promise<{ res: Response; url: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  const maxHops = options.maxHops ?? 5;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!(await options.hostCheck(current))) throw new GuardedFetchError("blocked", current);
    const res = await doFetch(current, {
      redirect: "manual",
      signal,
      ...(options.headers ? { headers: options.headers } : {}),
    });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return { res, url: current };
    await res.body?.cancel().catch(() => undefined);
    try {
      current = new URL(location, current).toString();
    } catch {
      throw new GuardedFetchError("blocked", location);
    }
  }
  throw new GuardedFetchError("too_many_redirects", current);
}

/** Read at most `maxBytes` of a body; the rest is never downloaded (the stream is cancelled). */
export async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

export async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode((await readCapped(res, maxBytes)).bytes);
}
