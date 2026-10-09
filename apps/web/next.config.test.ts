import { afterEach, describe, expect, it, vi } from "vitest";

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rulesFor(baseUrl?: string): Promise<Rule[]> {
  vi.resetModules();
  if (baseUrl) vi.stubEnv("FORGECY_BASE_URL", baseUrl);
  const mod = await import("./next.config");
  return (await mod.default.headers!()) as Rule[];
}
const matching = (rules: Rule[], path: string) =>
  rules.filter((r) => new RegExp(`^${r.source}$`).test(path)).flatMap((r) => r.headers);
const value = (headers: Rule["headers"], key: string) => headers.find((h) => h.key === key)?.value;

afterEach(() => vi.unstubAllEnvs());

describe("security headers", () => {
  it("applies the baseline to app pages and API routes", async () => {
    const rules = await rulesFor("http://localhost:3000");
    for (const path of ["/", "/clients", "/login", "/api/jobs/abc/events"]) {
      const h = matching(rules, path);
      expect(value(h, "X-Content-Type-Options"), path).toBe("nosniff");
      expect(value(h, "Referrer-Policy"), path).toBe("strict-origin-when-cross-origin");
      expect(value(h, "X-Frame-Options"), path).toBe("SAMEORIGIN");
      const csp = value(h, "Content-Security-Policy") ?? "";
      expect(csp, path).toContain("frame-ancestors 'self'");
      expect(csp, path).toContain("object-src 'none'");
      expect(csp, path).toContain("base-uri 'self'");
    }
  });

  it("leaves /render and /api/files to their own, stricter headers", async () => {
    const rules = await rulesFor("http://localhost:3000");
    for (const path of [
      "/render/slide",
      "/render/templates/t1/l1",
      "/api/files/clients/c/brand/x.svg",
    ])
      expect(matching(rules, path), path).toEqual([]);
  });

  it("adds HSTS only on an https base URL", async () => {
    expect(
      value(matching(await rulesFor("http://localhost:3000"), "/"), "Strict-Transport-Security"),
    ).toBeUndefined();
    expect(
      value(
        matching(await rulesFor("https://forgecy.example.com"), "/"),
        "Strict-Transport-Security",
      ),
    ).toMatch(/^max-age=\d+$/);
  });
});
