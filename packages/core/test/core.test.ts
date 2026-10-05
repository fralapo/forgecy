import { describe, expect, it } from "vitest";
import { can, checkAiPolicy, loadEnv, transitionPermission } from "../src";

describe("permissions", () => {
  const user = { type: "user" as const, id: "u1", isAdmin: false, active: true };
  const admin = { ...user, isAdmin: true };

  it("grants every content permission to an active user", () => {
    expect(can(user, "approve")).toBe(true);
    expect(can(user, "brand_identity.approve")).toBe(true);
  });

  it("reserves settings to admins", () => {
    expect(can(user, "users.manage")).toBe(false);
    expect(can(admin, "users.manage")).toBe(true);
  });

  it("denies everything to inactive users", () => {
    expect(can({ ...admin, active: false }, "view")).toBe(false);
  });

  it("never lets an agent approve, publish or archive", () => {
    const agent = { type: "agent" as const, role: "reviewer" as const };
    expect(can(agent, "view")).toBe(true);
    expect(can(agent, "propose")).toBe(true);
    for (const p of ["approve", "publish", "archive", "brand_identity.approve", "settings.manage"] as const) {
      expect(can(agent, p)).toBe(false);
    }
  });
});

describe("AI policy", () => {
  it("blocks all AI under no_ai", () => {
    expect(checkAiPolicy("no_ai", "local")).toEqual({ allowed: false, reason: "no_ai" });
  });
  it("never lets local_only reach a cloud provider", () => {
    expect(checkAiPolicy("local_only", "anthropic").allowed).toBe(false);
    expect(checkAiPolicy("local_only", "local").allowed).toBe(true);
  });
  it("restricts to approved providers", () => {
    expect(checkAiPolicy("external_restricted", "openai", ["anthropic"]).allowed).toBe(false);
    expect(checkAiPolicy("external_restricted", "anthropic", ["anthropic"]).allowed).toBe(true);
  });
});

describe("content transitions", () => {
  it("needs approve to approve and rejects skipping review", () => {
    expect(transitionPermission("in_review", "approved")).toBe("approve");
    expect(transitionPermission("draft", "approved")).toBeNull();
  });
});

describe("env", () => {
  it("parses lists and defaults", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://x",
      BETTER_AUTH_SECRET: "x".repeat(32),
      FORGECY_ALLOWED_EMAIL_DOMAINS: "Agency.it, studio.com",
    });
    expect(env.FORGECY_ALLOWED_EMAIL_DOMAINS).toEqual(["agency.it", "studio.com"]);
    expect(env.FORGECY_AUTH_MODE).toBe("local");
    expect(env.FORGECY_MAGIC_LINK_TTL_MINUTES).toBe(15);
  });
  it("fails loudly on a short secret", () => {
    expect(() => loadEnv({ DATABASE_URL: "x", BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
