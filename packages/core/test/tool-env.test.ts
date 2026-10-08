import { describe, expect, it } from "vitest";
import { envSchema, loadEnv, loadToolEnv } from "../src";

describe("loadToolEnv", () => {
  it("needs neither a database nor a secret", () => {
    expect(loadToolEnv({})).toEqual({ FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: false });
  });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
    ["", false],
  ])("reads FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS=%j as %s", (value, expected) => {
    expect(loadToolEnv({ FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: value })).toMatchObject({
      FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: expected,
    });
  });

  it("fails loudly on a typo instead of silently changing the SSRF guard", () => {
    expect(() => loadToolEnv({ FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: "yes" })).toThrow(
      /Invalid Forgecy configuration[\s\S]*FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS/,
    );
  });

  it("reads the two paths", () => {
    expect(
      loadToolEnv({ FORGECY_CHROMIUM_PATH: "/usr/bin/chromium", FORGECY_TEMPLATES_DIR: "/t" }),
    ).toMatchObject({ FORGECY_CHROMIUM_PATH: "/usr/bin/chromium", FORGECY_TEMPLATES_DIR: "/t" });
  });
});

describe("loadEnv additions", () => {
  const base = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "x".repeat(32) };
  it("defaults the worker health port and exposes the tool settings", () => {
    const env = loadEnv({ ...base, FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: "true" });
    expect(env.WORKER_HEALTH_PORT).toBe(3001);
    expect(env.FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS).toBe(true);
  });
  it("rejects an impossible worker port", () => {
    expect(() => loadEnv({ ...base, WORKER_HEALTH_PORT: "70000" })).toThrow(/WORKER_HEALTH_PORT/);
  });
  it("no longer knows the unused render token", () => {
    expect("FORGECY_RENDER_TOKEN" in envSchema.shape).toBe(false);
  });
});
