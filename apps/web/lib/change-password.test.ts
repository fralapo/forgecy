import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "session=abc" }) }));

const changePassword = vi.fn();
vi.mock("./auth", () => ({ auth: { api: { changePassword } } }));

let rows: { password: string | null }[] = [];
const where = vi.fn();
vi.mock("@forgecy/db", () => ({
  accounts: { password: "password", userId: "userId", providerId: "providerId" },
  and: (...c: unknown[]) => ({ and: c }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          where(w);
          return { limit: async () => rows };
        },
      }),
    }),
  }),
}));

const { APIError } = await import("better-auth/api");
const { changeOwnPassword, hasPassword } = await import("./change-password");

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  changePassword.mockResolvedValue({ token: "t" });
});

describe("changeOwnPassword", () => {
  it("rejects a bad new password before calling Better Auth", async () => {
    expect(await changeOwnPassword("old", "")).toEqual({
      error: { key: "validation.passwordTooShort", values: { min: 1 } },
    });
    expect(await changeOwnPassword("old", "x".repeat(129))).toMatchObject({
      error: { key: "validation.passwordTooLong" },
    });
    expect(await changeOwnPassword("same", "same")).toEqual({
      error: { key: "settings.password.unchanged" },
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("verifies the current password through Better Auth and signs the other devices out", async () => {
    expect(await changeOwnPassword("old", "new")).toEqual({ ok: true });
    expect(changePassword).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { currentPassword: "old", newPassword: "new", revokeOtherSessions: true },
    });
  });

  it("reports a wrong current password", async () => {
    changePassword.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Invalid password" }),
    );
    expect(await changeOwnPassword("bad", "new")).toEqual({
      error: { key: "settings.password.wrongCurrent" },
    });
  });

  it("maps a person without a credential account to a translated message instead of throwing", async () => {
    changePassword.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "CREDENTIAL_ACCOUNT_NOT_FOUND", message: "Credential account not found" }),
    );
    expect(await changeOwnPassword("old", "new")).toEqual({
      error: { key: "settings.password.noPassword" },
    });
  });

  it("rethrows any other failure", async () => {
    const boom = new APIError("UNAUTHORIZED", { message: "Unauthorized" });
    changePassword.mockRejectedValue(boom);
    await expect(changeOwnPassword("old", "new")).rejects.toBe(boom);
    const other = new Error("db down");
    changePassword.mockRejectedValue(other);
    await expect(changeOwnPassword("old", "new")).rejects.toBe(other);
  });
});

describe("hasPassword", () => {
  it("is true for a credential account with a password hash", async () => {
    rows = [{ password: "hash" }];
    expect(await hasPassword("u1")).toBe(true);
  });

  it("is false without a credential account or without a hash", async () => {
    rows = [];
    expect(await hasPassword("u1")).toBe(false);
    rows = [{ password: null }];
    expect(await hasPassword("u1")).toBe(false);
  });

  it("looks only at the caller's credential account", async () => {
    await hasPassword("u1");
    expect(where).toHaveBeenCalledWith({
      and: [{ eq: ["userId", "u1"] }, { eq: ["providerId", "credential"] }],
    });
  });
});
