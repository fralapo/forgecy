import { createServer, type Server } from "node:http";
import type * as Dns from "node:dns";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import type * as DnsPromises from "node:dns/promises";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof Dns>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsPromises>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});

import { lookup as dnsLookup } from "node:dns";
import { lookup as dnsPromiseLookup } from "node:dns/promises";
import { createHtmlFetcher } from "../src/crawl/fetcher";
import { createHostCheck, createPinnedFetch, resolvePinnedAddress } from "../src/url";

// Both the tests here and `resolvePinnedAddress`/`createPinnedFetch` only ever call
// these with the "all addresses" shape, so the mocks are typed to that one overload.
type DnsLookupAll = (
  hostname: string,
  options: LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;
type DnsPromiseLookupAll = (
  hostname: string,
  options: LookupAllOptions,
) => Promise<LookupAddress[]>;

const dnsLookupMock = vi.mocked(dnsLookup) as unknown as Mock<DnsLookupAll>;
const dnsPromiseLookupMock = vi.mocked(dnsPromiseLookup) as unknown as Mock<DnsPromiseLookupAll>;

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((_req, res) => res.end("<html><body>ok</body></html>"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("DNS rebinding", () => {
  it("resolvePinnedAddress refuses a host whose DNS answer is private", async () => {
    dnsPromiseLookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect(await resolvePinnedAddress("rebind.example.com")).toBeNull();
  });

  it("resolvePinnedAddress accepts a host whose DNS answer is public", async () => {
    dnsPromiseLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    expect(await resolvePinnedAddress("example.com")).toBe("93.184.216.34");
  });

  it("createPinnedFetch blocks the real connection even when an earlier host check saw a public address", async () => {
    // The host check's own lookup answers safely, the way a TOCTOU rebinding attacker
    // wants an earlier validation step to see.
    dnsPromiseLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    const hostCheck = createHostCheck();
    expect(await hostCheck("http://rebind.example.com/")).toBe(true);

    // The moment the connection is actually made, the name server answers with a
    // different, private address instead (the rebind). The pinned fetch's own
    // connect-time lookup must still catch this: it never trusts the earlier answer.
    dnsLookupMock.mockImplementationOnce((_hostname, _options, callback) => {
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
    });
    const doFetch = createPinnedFetch();
    const err = await doFetch(`http://rebind.example.com:${port}/`).catch((e: unknown) => e);
    expect(
      `${(err as Error).message} ${((err as Error).cause as Error | undefined)?.message}`,
    ).toMatch(/disallowed address/);
  });

  it("allowPrivate lifts the pin, matching createHostCheck's own escape hatch", async () => {
    const doFetch = createPinnedFetch({ allowPrivate: true });
    const res = await doFetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
  });
});

describe("redirect to a rebound/private address", () => {
  it("createHtmlFetcher's per-hop host check blocks a redirect to a private address", async () => {
    const hostCheck = createHostCheck();
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/evil" },
      })) as unknown as typeof fetch;
    const fetcher = createHtmlFetcher({ userAgent: "ForgecyAudit/test", hostCheck, fetchImpl });
    await expect(
      fetcher.fetchPage("http://public.example.com/", { timeoutMs: 5000, screenshots: false }),
    ).rejects.toMatchObject({ code: "AUD-HOST-BLOCKED" });
  });
});
