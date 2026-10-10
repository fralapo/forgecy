import { describe, expect, it } from "vitest";
import {
  assertClientAccess,
  can,
  canAccessClient,
  canViewJob,
  PermissionDeniedError,
  checkAiPolicy,
  loadEnv,
  resolveDefaultAiPolicy,
  transitionPermission,
} from "../src";

describe("permissions", () => {
  const user = {
    type: "user" as const,
    id: "u1",
    isAdmin: false,
    active: true,
    clients: "all" as const,
  };
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
    for (const p of [
      "approve",
      "publish",
      "archive",
      "brand_identity.approve",
      "settings.manage",
    ] as const) {
      expect(can(agent, p)).toBe(false);
    }
  });

  it("limits a person to the clients assigned to them (ADR 0020)", () => {
    const x = "11111111-1111-1111-1111-111111111111";
    const y = "22222222-2222-2222-2222-222222222222";
    const member = { ...user, clients: [x] };
    expect(canAccessClient(member, x)).toBe(true);
    expect(canAccessClient(member, y)).toBe(false);
    expect(can(member, "approve", x)).toBe(true);
    expect(can(member, "view", y)).toBe(false);
    // Without a clientId the answer is about the action only; lists filter by scope.
    expect(can(member, "view")).toBe(true);
    expect(() => assertClientAccess(member, y)).toThrow(PermissionDeniedError);
    const nobody = { ...user, clients: [] };
    expect(can(nobody, "view", x)).toBe(false);
    // Admins reach every client whatever their list says; inactive people none.
    expect(can({ ...admin, clients: [] }, "view", y)).toBe(true);
    expect(canAccessClient({ ...admin, active: false }, x)).toBe(false);
    // Agents act inside a job a person started: the person's access was checked there.
    const agent = { type: "agent" as const, role: "reviewer" as const };
    expect(can(agent, "propose", y)).toBe(true);
  });

  it("a clientId never widens what an actor may do", () => {
    const client = "11111111-1111-1111-1111-111111111111";
    expect(can(user, "users.manage", client)).toBe(false);
    expect(can({ ...admin, active: false }, "view", client)).toBe(false);
    const agent = { type: "agent" as const, role: "reviewer" as const };
    expect(can(agent, "approve", client)).toBe(false);
    expect(can(agent, "propose", client)).toBe(true);
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
  it("reads the stored default policy, external_allowed when there is none or it is not a policy", () => {
    expect(resolveDefaultAiPolicy("local_only")).toBe("local_only");
    expect(resolveDefaultAiPolicy(undefined)).toBe("external_allowed");
    expect(resolveDefaultAiPolicy("anything")).toBe("external_allowed");
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
    expect(() => loadEnv({ DATABASE_URL: "x", BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });
  it("accepts an unset or empty setup token and rejects a short one", () => {
    const base = { DATABASE_URL: "x", BETTER_AUTH_SECRET: "x".repeat(32) };
    expect(loadEnv({ ...base }).FORGECY_SETUP_TOKEN).toBeUndefined();
    expect(loadEnv({ ...base, FORGECY_SETUP_TOKEN: "" }).FORGECY_SETUP_TOKEN).toBeUndefined();
    expect(loadEnv({ ...base, FORGECY_SETUP_TOKEN: "x".repeat(16) }).FORGECY_SETUP_TOKEN).toBe(
      "x".repeat(16),
    );
    expect(() => loadEnv({ ...base, FORGECY_SETUP_TOKEN: "short" })).toThrow(/FORGECY_SETUP_TOKEN/);
  });
  it("reads public Instagram profiles unless it is switched off with exactly false", () => {
    const base = { DATABASE_URL: "x", BETTER_AUTH_SECRET: "x".repeat(32) };
    expect(loadEnv({ ...base }).FORGECY_SOCIAL_PUBLIC_WEB).toBe(true);
    expect(loadEnv({ ...base, FORGECY_SOCIAL_PUBLIC_WEB: "" }).FORGECY_SOCIAL_PUBLIC_WEB).toBe(
      true,
    );
    expect(loadEnv({ ...base, FORGECY_SOCIAL_PUBLIC_WEB: "true" }).FORGECY_SOCIAL_PUBLIC_WEB).toBe(
      true,
    );
    expect(loadEnv({ ...base, FORGECY_SOCIAL_PUBLIC_WEB: "false" }).FORGECY_SOCIAL_PUBLIC_WEB).toBe(
      false,
    );
    for (const v of ["1", "TRUE", "yes"])
      expect(() => loadEnv({ ...base, FORGECY_SOCIAL_PUBLIC_WEB: v })).toThrow(
        /FORGECY_SOCIAL_PUBLIC_WEB/,
      );
    expect(loadEnv({ ...base }).INSTAGRAM_GRAPH_VERSION).toBe("v23.0");
  });
});

describe("job visibility", () => {
  const user = {
    type: "user" as const,
    id: "u1",
    isAdmin: false,
    active: true,
    clients: "all" as const,
  };
  const admin = { ...user, isAdmin: true };

  it("lets any active person watch an ordinary job", () => {
    expect(canViewJob(user, { kind: "content.generate_outline", clientId: "c1" })).toBe(true);
    expect(canViewJob(user, { kind: "system.ping", clientId: null })).toBe(true);
  });

  it("keeps backup, restore and client transfer jobs for the Admin", () => {
    for (const kind of [
      "system.backup",
      "system.restore",
      "client.export",
      "client.import.verify",
      "client.import",
    ]) {
      expect(canViewJob(user, { kind, clientId: null })).toBe(false);
      expect(canViewJob(admin, { kind, clientId: null })).toBe(true);
    }
  });

  it("denies inactive people and does not trust prototype keys", () => {
    expect(canViewJob({ ...admin, active: false }, { kind: "system.ping", clientId: null })).toBe(
      false,
    );
    expect(canViewJob(user, { kind: "constructor", clientId: null })).toBe(true);
  });

  it("hides the jobs of a client the person cannot access", () => {
    const member = { ...user, clients: ["c1"] };
    expect(canViewJob(member, { kind: "content.generate_outline", clientId: "c1" })).toBe(true);
    expect(canViewJob(member, { kind: "content.generate_outline", clientId: "c2" })).toBe(false);
  });
});
