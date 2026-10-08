import type * as DnsPromises from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsPromises>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});

import { lookup as dnsPromiseLookup } from "node:dns/promises";
import type { JobContext } from "@forgecy/jobs";
import { allowBrowserRequest, pinRootHost } from "../src/crawl/browser";
import { crawlError } from "../src/errors";
import type { AuditHandlerDeps } from "../src/handlers/context";
import { openFetcher } from "../src/handlers/crawl";
import { createHostCheck } from "../src/url";

const lookupMock = vi.mocked(dnsPromiseLookup) as unknown as Mock<
  (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>
>;
beforeEach(() => lookupMock.mockReset());

describe("pinRootHost fails closed", () => {
  it("pins a public root host", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    expect(await pinRootHost("https://example.com/", false)).toEqual(["MAP example.com 93.184.216.34"]);
  });

  it("brackets an IPv6 answer", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "2606:4700::1111", family: 6 }]);
    expect(await pinRootHost("https://example.com/", false)).toEqual(["MAP example.com [2606:4700::1111]"]);
  });

  it("refuses to launch unpinned when the root host resolves to a private address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(pinRootHost("https://rebind.example.com/", false)).rejects.toMatchObject({
      code: "AUD-HOST-BLOCKED",
    });
  });

  it("refuses a private or hex-mapped IP literal root", async () => {
    await expect(pinRootHost("http://[::ffff:a9fe:a9fe]/", false)).rejects.toMatchObject({ code: "AUD-HOST-BLOCKED" });
    await expect(pinRootHost("http://10.0.0.1/", false)).rejects.toMatchObject({ code: "AUD-HOST-BLOCKED" });
  });

  it("reports an unresolvable root as browser-unavailable (so the HTML path reports it)", async () => {
    lookupMock.mockRejectedValueOnce(Object.assign(new Error("nx"), { code: "ENOTFOUND" }));
    await expect(pinRootHost("https://nope.example.com/", false)).rejects.toMatchObject({
      code: "AUD-BROWSER-UNAVAILABLE",
    });
  });

  it("does nothing for allowPrivate or without a root URL", async () => {
    expect(await pinRootHost("http://127.0.0.1/", true)).toEqual([]);
    expect(await pinRootHost(undefined, false)).toEqual([]);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe("allowBrowserRequest gates subresources and XHR, not only navigations", () => {
  const hostCheck = createHostCheck();
  it("blocks the local network, metadata, hex-mapped and non-http schemes", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.1/api",
      "http://[::ffff:a9fe:a9fe]/",
      "http://localhost:3000/api/health",
      "file:///etc/passwd",
      "ftp://93.184.216.34/x",
    ])
      expect(await allowBrowserRequest(url, hostCheck), url).toBe(false);
  });
  it("allows public hosts and inline schemes", async () => {
    for (const url of ["https://93.184.216.34/app.js", "data:image/png;base64,AAAA", "blob:https://x/1", "about:blank"])
      expect(await allowBrowserRequest(url, hostCheck), url).toBe(true);
  });
});

describe("openFetcher", () => {
  const ctx = { jobId: "j1", logger: { warn: vi.fn() } } as unknown as JobContext;
  const deps = (err: Error) =>
    ({
      createFetcher: async () => {
        throw err;
      },
      userAgent: "ua",
      hostCheck: async () => true,
      allowPrivate: false,
    }) as unknown as AuditHandlerDeps;

  it("falls back to the HTML fetcher when Chromium cannot be pinned, so the scan fails with its recorded error", async () => {
    const blocked = crawlError("AUD-HOST-BLOCKED", "audit.stored.crawl.hostLocal", { host: "x" });
    expect((await openFetcher(deps(blocked), ctx, "https://x/")).mode).toBe("html");
    const unavailable = crawlError("AUD-BROWSER-UNAVAILABLE", "audit.stored.crawl.browserUnavailable", { detail: "d" });
    expect((await openFetcher(deps(unavailable), ctx, "https://x/")).mode).toBe("html");
  });

  it("rethrows anything else", async () => {
    await expect(openFetcher(deps(new Error("boom")), ctx, "https://x/")).rejects.toThrow("boom");
  });
});
