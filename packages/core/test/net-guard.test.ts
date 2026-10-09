import { createServer, type Server } from "node:http";
import type * as Dns from "node:dns";
import type * as DnsPromises from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof Dns>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsPromises>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});

import { lookup as dnsPromiseLookup } from "node:dns/promises";
import { lookup as dnsLookup } from "node:dns";
import {
  createHostCheck,
  createPinnedFetch,
  isPrivateAddress,
  resolvePublicAddress,
} from "../src/net-guard";

type LookupAll = (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>;
const lookupMock = vi.mocked(dnsPromiseLookup) as unknown as Mock<LookupAll>;

type CbLookup = (
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;
const cbLookupMock = vi.mocked(dnsLookup) as unknown as Mock<CbLookup>;

beforeEach(() => lookupMock.mockReset());

const BLOCKED = [
  // IPv4 (the old table plus the documentation / IETF ranges it missed)
  "0.0.0.0",
  "127.0.0.1",
  "10.0.0.1",
  "100.64.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "172.31.255.255",
  "192.0.0.192",
  "192.0.2.1",
  "192.168.0.1",
  "198.18.0.1",
  "198.51.100.1",
  "203.0.113.9",
  "224.0.0.1",
  "240.0.0.1",
  "255.255.255.255",
  // IPv6 loopback / unspecified in every spelling
  "::",
  "::1",
  "0:0:0:0:0:0:0:1",
  "0000:0000:0000:0000:0000:0000:0000:0001",
  // IPv4-mapped: dotted, hex, long form, SIIT
  "::ffff:10.0.0.1",
  "::ffff:169.254.169.254",
  "::ffff:a9fe:a9fe",
  "::ffff:7f00:1",
  "0:0:0:0:0:ffff:a9fe:a9fe",
  "::ffff:0:a9fe:a9fe",
  // IPv4-compatible, NAT64 (both prefixes), 6to4, Teredo
  "::127.0.0.1",
  "::7f00:1",
  "64:ff9b::a9fe:a9fe",
  "64:ff9b::808:808",
  "64:ff9b:1::1",
  "2002:a9fe:a9fe::1",
  "2002:7f00:1::",
  "2001:0:4136:e378:8000:63bf:3fff:fdd2",
  // ULA (incl. AWS IMDS v6), link-local (+ zone id), site-local, multicast, discard, documentation
  "fc00::1",
  "fd00:ec2::254",
  "fe80::1",
  "fe80::1%eth0",
  "fec0::1",
  "ff02::1",
  "100::1",
  "2001:db8::1",
  // not an IP at all, or a spelling the OS would read differently (octal): fail closed
  "",
  "not-an-ip",
  "012.0.0.1",
  "1.2.3",
  "999.1.1.1",
  "[::1]",
];

const PUBLIC = [
  "93.184.216.34",
  "8.8.8.8",
  "172.15.255.255",
  "172.32.0.1",
  "100.128.0.1",
  "2606:4700::1111",
  "2a00:1450:4002::1",
  "2001:4860:4860::8888",
  "::ffff:8.8.8.8",
  "::ffff:808:808",
];

describe("isPrivateAddress", () => {
  it.each(BLOCKED)("blocks %j", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(PUBLIC)("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("createHostCheck cache", () => {
  const url = "http://rebind.example.com/";

  it("re-resolves after the TTL, so a name that rebinds to a private address is caught", async () => {
    let t = 0;
    const check = createHostCheck({ ttlMs: 1000, now: () => t });
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    expect(await check(url)).toBe(true);

    t = 500; // inside the TTL: served from the cache, no second DNS query
    expect(await check(url)).toBe(true);
    expect(lookupMock).toHaveBeenCalledTimes(1);

    t = 1500; // expired: asked again, and now it is private
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    expect(await check(url)).toBe(false);
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed lookup", async () => {
    const check = createHostCheck({ ttlMs: 60_000, now: () => 0 });
    lookupMock.mockRejectedValueOnce(Object.assign(new Error("nx"), { code: "ENOTFOUND" }));
    expect(await check(url)).toBe(true); // fetch will fail with "unreachable" on its own
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect(await check(url)).toBe(false); // not stuck on the earlier "true"
  });

  it("allowPrivate bypasses everything", async () => {
    expect(await createHostCheck({ allowPrivate: true })("http://127.0.0.1/")).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe("createHostCheck failClosed (Chromium resolves names itself)", () => {
  const url = "http://split-horizon.example.com/";
  const nx = () => Object.assign(new Error("nx"), { code: "ENOTFOUND" });

  it("an unresolvable host passes by default and is refused with failClosed", async () => {
    lookupMock.mockRejectedValueOnce(nx());
    expect(await createHostCheck()(url)).toBe(true);
    lookupMock.mockRejectedValueOnce(nx());
    expect(await createHostCheck({ failClosed: true })(url)).toBe(false);
  });

  it("an empty answer is refused with failClosed", async () => {
    lookupMock.mockResolvedValueOnce([]);
    expect(await createHostCheck({ failClosed: true })(url)).toBe(false);
  });

  it("a mixed public/private answer passes by default (the pinned fetch only connects to the public one) but not with failClosed (the client may fall back to the private one)", async () => {
    const mixed = [
      { address: "127.0.0.1", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ];
    lookupMock.mockResolvedValueOnce(mixed);
    expect(await createHostCheck()(url)).toBe(true);
    lookupMock.mockResolvedValueOnce(mixed);
    expect(await createHostCheck({ failClosed: true })(url)).toBe(false);
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect(await createHostCheck()(url)).toBe(false);
  });

  it("resolvePublicAddress pins the public answer of a mixed name and refuses an all-private one", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "::", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(await resolvePublicAddress("mixed.example.com")).toEqual({
      ok: true,
      address: "93.184.216.34",
    });
    lookupMock.mockResolvedValueOnce([
      { address: "::", family: 6 },
      { address: "10.0.0.5", family: 4 },
    ]);
    expect(await resolvePublicAddress("private.example.com")).toEqual({
      ok: false,
      reason: "private",
    });
  });

  it("still allows a public host, and allowPrivate still bypasses", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    expect(await createHostCheck({ failClosed: true })(url)).toBe(true);
    expect(await createHostCheck({ allowPrivate: true, failClosed: true })(url)).toBe(true);
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });
});

describe("createPinnedFetch", () => {
  let server: Server;
  let port: number;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits++;
      res.end("hit");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    hits = 0;
    cbLookupMock.mockReset();
  });

  const messageOf = (e: unknown) => {
    const err = e as Error & { cause?: Error };
    return `${err.message} | ${err.cause?.message ?? ""}`;
  };

  it("enforces the connect-time lookup: a name that resolves to loopback never connects", async () => {
    cbLookupMock.mockImplementationOnce((_h, _o, cb) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }]),
    );
    const err = await createPinnedFetch()(`http://rebind.example.com:${port}/`).catch(
      (e: unknown) => e,
    );
    // Before the fix this was "invalid onRequestStart method": the dispatcher was never honored.
    expect(messageOf(err)).toMatch(/disallowed address/);
    expect(hits).toBe(0);
  });

  it("refuses a name whose answers are all private, and connects to nothing", async () => {
    cbLookupMock.mockImplementationOnce((_h, _o, cb) =>
      cb(null, [
        { address: "10.0.0.5", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    );
    const err = await createPinnedFetch()(`http://private.example.com:${port}/`).catch(
      (e: unknown) => e,
    );
    expect(messageOf(err)).toMatch(/disallowed address/);
    expect(hits).toBe(0);
  });

  it.each([
    `http://127.0.0.1:PORT/`,
    `http://[::ffff:7f00:1]:PORT/`,
    `http://[::ffff:127.0.0.1]:PORT/`,
    `http://[64:ff9b::7f00:1]:PORT/`,
    `http://169.254.169.254/latest/meta-data/`,
  ])(
    "refuses the private IP literal %s before any connection (connect.lookup is skipped for literals)",
    async (tpl) => {
      const err = await createPinnedFetch()(tpl.replace("PORT", String(port))).catch(
        (e: unknown) => e,
      );
      expect(messageOf(err)).toMatch(/disallowed address/);
      expect(hits).toBe(0);
      expect(cbLookupMock).not.toHaveBeenCalled();
    },
  );

  it("allowPrivate returns the plain fetch", async () => {
    const res = await createPinnedFetch({ allowPrivate: true })(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe("hit");
  });
});
