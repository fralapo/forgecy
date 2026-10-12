import type * as DnsPromises from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// playwright-core is stubbed so no Chromium is needed: these tests pin the WIRING inside
// createBrowserFetcher (fail-closed launch, per-request abort, websocket gate), which the
// helper tests in browser-guard.test.ts cannot see.
type RouteHandler = (route: unknown) => Promise<void>;
type WsHandler = (ws: unknown) => Promise<void>;
/** A fake Playwright Request: its URL and the hop it was redirected from (null for the first). */
interface FakeRequest {
  url: () => string;
  redirectedFrom: () => FakeRequest | null;
}
const state = vi.hoisted(() => {
  const routes: unknown[] = [];
  const wsHandlers: unknown[] = [];
  /** What the next page.goto does: its redirect chain, plus redirect chains of subresources. */
  const nav = { chain: [] as string[], subrequests: [] as string[][] };
  const screenshot = vi.fn(async () => new Uint8Array([1]));
  const chainOf = (urls: string[]) =>
    urls.reduce<FakeRequest | null>(
      (prev, url) => ({ url: () => url, redirectedFrom: () => prev }),
      null,
    );
  const newPage = async () => {
    const listeners: Array<(req: FakeRequest) => void> = [];
    let current = "about:blank";
    // Playwright emits "request" for every hop of a chain, the redirected ones included.
    const emitChain = (urls: string[]) => {
      for (let i = 1; i <= urls.length; i++) {
        const req = chainOf(urls.slice(0, i))!;
        for (const listener of listeners) listener(req);
      }
    };
    return {
      on: (event: string, listener: (req: FakeRequest) => void) => {
        if (event === "request") listeners.push(listener);
      },
      setDefaultTimeout: () => undefined,
      goto: async () => {
        emitChain(nav.chain);
        for (const sub of nav.subrequests) emitChain(sub);
        current = nav.chain.at(-1) ?? "about:blank";
        return { status: () => 200, request: () => chainOf(nav.chain) };
      },
      waitForLoadState: async () => undefined,
      url: () => current,
      content: async () => "<html><head><title>internal</title></head><body>secret</body></html>",
      evaluate: async () => ({ colors: [], fonts: [], loadMs: 0 }),
      viewportSize: () => ({ width: 1366, height: 900 }),
      screenshot,
      close: async () => undefined,
    };
  };
  const launch = vi.fn(async (_options: { args: string[] }) => ({
    newContext: async () => ({
      addInitScript: async () => undefined,
      route: async (_pattern: string, handler: unknown) => void routes.push(handler),
      routeWebSocket: async (_pattern: unknown, handler: unknown) => void wsHandlers.push(handler),
      newPage,
    }),
    close: async () => undefined,
  }));
  return { launch, routes, wsHandlers, nav, screenshot };
});

vi.mock("playwright-core", () => ({ chromium: { launch: state.launch } }));
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsPromises>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});

import { lookup as dnsPromiseLookup } from "node:dns/promises";
import { createBrowserFetcher } from "../src/crawl/browser";

const lookupMock = vi.mocked(dnsPromiseLookup) as unknown as Mock<
  (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>
>;
const base = { userAgent: "ua" };

beforeEach(() => {
  state.launch.mockClear();
  state.screenshot.mockClear();
  state.routes.length = 0;
  state.wsHandlers.length = 0;
  state.nav.chain = [];
  state.nav.subrequests = [];
  lookupMock.mockReset();
});

function fakeRoute(url: string, resourceType = "fetch") {
  return {
    request: () => ({ url: () => url, resourceType: () => resourceType }),
    abort: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
  };
}

describe("createBrowserFetcher launch", () => {
  it("never launches Chromium when the root host is private", async () => {
    await expect(
      createBrowserFetcher({ ...base, rootUrl: "http://10.0.0.1/", allowPrivate: false }),
    ).rejects.toMatchObject({ code: "AUD-HOST-BLOCKED" });
    expect(state.launch).not.toHaveBeenCalled();
  });

  it("launches pinned to the validated address for a public root", async () => {
    await createBrowserFetcher({ ...base, rootUrl: "http://93.184.216.34/", allowPrivate: false });
    expect(state.launch).toHaveBeenCalledOnce();
    const args = state.launch.mock.calls[0]![0].args;
    expect(args).toContain("--host-resolver-rules=MAP 93.184.216.34 93.184.216.34");
  });
});

describe("createBrowserFetcher request gate", () => {
  async function handlers() {
    await createBrowserFetcher({ ...base, rootUrl: "http://93.184.216.34/", allowPrivate: false });
    expect(state.routes.length).toBeGreaterThan(0);
    return state.routes as RouteHandler[];
  }

  it("aborts a private-host subresource with blockedbyclient and lets a public one through", async () => {
    for (const handler of await handlers()) {
      const blocked = fakeRoute("http://169.254.169.254/latest/meta-data/");
      await handler(blocked);
      expect(blocked.abort).toHaveBeenCalledWith("blockedbyclient");
      expect(blocked.continue).not.toHaveBeenCalled();

      const allowed = fakeRoute("https://93.184.216.34/app.js", "script");
      await handler(allowed);
      expect(allowed.continue).toHaveBeenCalledOnce();
      expect(allowed.abort).not.toHaveBeenCalled();
    }
  });

  it("fails closed: a host Node cannot resolve is aborted (Chromium would resolve it itself)", async () => {
    for (const handler of await handlers()) {
      lookupMock.mockRejectedValueOnce(Object.assign(new Error("nx"), { code: "ENOTFOUND" }));
      const split = fakeRoute("http://split-horizon.example.com/admin");
      await handler(split);
      expect(split.abort).toHaveBeenCalledWith("blockedbyclient");
      expect(split.continue).not.toHaveBeenCalled();
    }
  });

  it("still aborts media without consulting the host check", async () => {
    for (const handler of await handlers()) {
      const media = fakeRoute("https://93.184.216.34/v.mp4", "media");
      await handler(media);
      expect(media.abort).toHaveBeenCalledOnce();
      expect(media.continue).not.toHaveBeenCalled();
    }
  });
});

describe("createBrowserFetcher websocket gate", () => {
  function fakeWs(url: string) {
    return {
      url: () => url,
      close: vi.fn(async () => undefined),
      connectToServer: vi.fn(() => ({})),
    };
  }

  it("closes sockets to private hosts and connects public ones", async () => {
    await createBrowserFetcher({ ...base, rootUrl: "http://93.184.216.34/", allowPrivate: false });
    expect(state.wsHandlers.length).toBeGreaterThan(0);
    for (const handler of state.wsHandlers as WsHandler[]) {
      const blocked = fakeWs("ws://127.0.0.1:3001/health");
      await handler(blocked);
      expect(blocked.close).toHaveBeenCalledOnce();
      expect(blocked.connectToServer).not.toHaveBeenCalled();

      const allowed = fakeWs("wss://93.184.216.34/socket");
      await handler(allowed);
      expect(allowed.connectToServer).toHaveBeenCalledOnce();
      expect(allowed.close).not.toHaveBeenCalled();
    }
  });
});

describe("createBrowserFetcher redirect hops (route() only sees the first URL of a chain)", () => {
  const ROOT = "http://93.184.216.34/";
  const opts = { timeoutMs: 5000, screenshots: true };
  const fetcher = () => createBrowserFetcher({ ...base, rootUrl: ROOT, allowPrivate: false });

  it("keeps a page whose chain stays public", async () => {
    state.nav.chain = [ROOT, "http://93.184.216.35/home"];
    const page = await (await fetcher()).fetchPage(ROOT, opts);
    expect(page.finalUrl).toBe("http://93.184.216.35/home");
    expect(page.title).toBe("internal");
  });

  it("discards the page when the navigation is redirected to the local network", async () => {
    state.nav.chain = [ROOT, "http://169.254.169.254/latest/meta-data/"];
    await expect((await fetcher()).fetchPage(ROOT, opts)).rejects.toMatchObject({
      code: "AUD-HOST-BLOCKED",
    });
    expect(state.screenshot).not.toHaveBeenCalled();
  });

  it("discards the page when a middle hop was private, even if the chain ends public", async () => {
    state.nav.chain = [ROOT, "http://192.168.1.1/", "http://93.184.216.35/"];
    await expect((await fetcher()).fetchPage(ROOT, opts)).rejects.toMatchObject({
      code: "AUD-HOST-BLOCKED",
    });
  });

  it("discards the page when a subresource is redirected to the local network", async () => {
    state.nav.chain = [ROOT];
    state.nav.subrequests = [["http://93.184.216.34/logo.png", "http://192.168.1.1/admin.png"]];
    await expect((await fetcher()).fetchPage(ROOT, opts)).rejects.toMatchObject({
      code: "AUD-HOST-BLOCKED",
    });
  });
});
