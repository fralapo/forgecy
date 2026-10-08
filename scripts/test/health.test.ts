import { describe, expect, it, vi } from "vitest";
import { checkHealth, healthTargets } from "../lib/health";

const reply = (status: number, body: string) =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

describe("healthTargets", () => {
  it("defaults to the loopback ports Compose publishes", () => {
    expect(healthTargets({})).toEqual([
      { name: "web", url: "http://127.0.0.1:3000/api/health" },
      { name: "worker", url: "http://127.0.0.1:3001/health" },
    ]);
  });

  it("follows the ports configured in .env", () => {
    const urls = (env: Record<string, string>) => healthTargets(env).map((t) => t.url);
    expect(urls({ FORGECY_PORT: "8080", FORGECY_WORKER_HEALTH_PORT: "9001" })).toEqual([
      "http://127.0.0.1:8080/api/health",
      "http://127.0.0.1:9001/health",
    ]);
    // `pnpm dev`: the worker listens on WORKER_HEALTH_PORT
    expect(urls({ WORKER_HEALTH_PORT: "3500" })[1]).toBe("http://127.0.0.1:3500/health");
  });

  it("lets a full URL win", () => {
    const targets = healthTargets({
      FORGECY_WEB_HEALTH_URL: "http://web.lan/api/health",
      FORGECY_WORKER_HEALTH_URL: "http://worker.lan/health",
    });
    expect(targets.map((t) => t.url)).toEqual([
      "http://web.lan/api/health",
      "http://worker.lan/health",
    ]);
  });
});

describe("checkHealth", () => {
  const target = [{ name: "worker", url: "http://127.0.0.1:3001/health" }];

  it("reports a healthy service", async () => {
    const [r] = await checkHealth(target, reply(200, '{"status":"ok"}'));
    expect(r).toMatchObject({ name: "worker", ok: true });
    expect(r?.line).toContain('ok  {"status":"ok"}');
  });

  it("reports an unhealthy service with its status", async () => {
    const [r] = await checkHealth(target, reply(503, '{"status":"error","db":"unreachable"}'));
    expect(r?.ok).toBe(false);
    expect(r?.line).toContain("error 503");
  });

  it("does not call a non-JSON reply (proxy 502 page) unreachable", async () => {
    const [r] = await checkHealth(target, reply(502, "<html>Bad Gateway</html>"));
    expect(r?.ok).toBe(false);
    expect(r?.line).toContain("error 502");
    expect(r?.line).not.toContain("unreachable");
  });

  it("does not call a 200 that is not JSON healthy (another app on the port)", async () => {
    const [r] = await checkHealth(target, reply(200, "<!DOCTYPE html><html></html>"));
    expect(r?.ok).toBe(false);
    expect(r?.line).toContain("not a health reply");
  });

  describe("terminal safety", () => {
    // C0, DEL and C1 controls: ESC/CSI/OSC introducers, BEL, newlines.
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
    const lineFor = async (status: number, body: string) =>
      (await checkHealth(target, reply(status, body)))[0]?.line ?? "";

    it.each([
      ["a clear-screen sequence", "\x1b[2Jboom"],
      ["an OSC title sequence", "\x1b]0;pwned\x07"],
      ["C1 controls", "\u009b2J\u009d0;pwned\u009c"],
    ])("strips %s from a non-JSON reply", async (_name, body) => {
      for (const status of [200, 502]) expect(await lineFor(status, body)).not.toMatch(CONTROLS);
    });

    it.each([
      ["an escaped ESC", JSON.stringify({ t: "\x1b[2Jboom" })],
      ["an escaped OSC", JSON.stringify({ t: "\x1b]0;pwned\x07" })],
      ["C1 controls", '{"t":"\u009b2J\u009d0;pwned\u009c"}'],
    ])("strips %s from a JSON reply", async (_name, body) => {
      for (const status of [200, 503]) expect(await lineFor(status, body)).not.toMatch(CONTROLS);
    });

    it("strips controls from a network error message", async () => {
      const failing = vi.fn(async () => {
        throw new Error("bad\x1b[2Jhost");
      }) as unknown as typeof fetch;
      const [r] = await checkHealth(target, failing);
      expect(r?.line).not.toMatch(CONTROLS);
    });
  });

  it("reports a network failure with the URL it tried", async () => {
    const failing = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const [r] = await checkHealth(target, failing);
    expect(r?.ok).toBe(false);
    expect(r?.line).toContain("unreachable (connect ECONNREFUSED)");
    expect(r?.line).toContain("http://127.0.0.1:3001/health");
  });

  it("checks every target independently", async () => {
    const mixed = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("3001")) throw new Error("down");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const results = await checkHealth(healthTargets({}), mixed);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
  });
});
