import { describe, expect, it } from "vitest";
import { envSchema, loadEnv, loadToolEnv } from "../src";

describe("loadToolEnv", () => {
  it("needs neither a database nor a secret", () => {
    expect(loadToolEnv({})).toEqual({ FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: false });
  });

  it.each([
    ["true", true],
    ["false", false],
    ["", false],
  ])("reads FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS=%j as %s", (value, expected) => {
    expect(loadToolEnv({ FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: value })).toMatchObject({
      FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: expected,
    });
  });

  // The old check was `=== "true"`: anything else meant off. Only that exact spelling may turn
  // the SSRF bypass on, and any other spelling fails closed instead of guessing.
  it.each(["1", "0", "TRUE", "True", "yes", "no", " true"])(
    "fails closed on FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS=%j and names the variable and the allowed values",
    (value) => {
      expect(() => loadToolEnv({ FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS: value })).toThrow(
        /Invalid Forgecy configuration[\s\S]*FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS must be exactly "true" or "false"/,
      );
    },
  );

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
