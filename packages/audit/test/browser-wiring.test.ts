import { beforeEach, describe, expect, it, vi } from "vitest";

// playwright-core is stubbed so no Chromium is needed: these tests pin the WIRING inside
// createBrowserFetcher (fail-closed launch, per-request abort, websocket gate), which the
// helper tests in browser-guard.test.ts cannot see.
type RouteHandler = (route: unknown) => Promise<void>;
type WsHandler = (ws: unknown) => Promise<void>;
const state = vi.hoisted(() => {
  const routes: unknown[] = [];
  const wsHandlers: unknown[] = [];
  const launch = vi.fn(async (_options: { args: string[] }) => ({
    newContext: async () => ({
      addInitScript: async () => undefined,
      route: async (_pattern: string, handler: unknown) => void routes.push(handler),
      routeWebSocket: async (_pattern: unknown, handler: unknown) => void wsHandlers.push(handler),
    }),
    close: async () => undefined,
  }));
  return { launch, routes, wsHandlers };
});

vi.mock("playwright-core", () => ({ chromium: { launch: state.launch } }));

import { createBrowserFetcher } from "../src/crawl/browser";
import { createHostCheck } from "../src/url";

const base = { userAgent: "ua", hostCheck: createHostCheck() };

beforeEach(() => {
  state.launch.mockClear();
  state.routes.length = 0;
  state.wsHandlers.length = 0;
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
