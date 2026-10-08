import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "session=abc" }) }));

const changePassword = vi.fn();
vi.mock("./auth", () => ({ auth: { api: { changePassword } } }));

const guard = { attempt: vi.fn(), refund: vi.fn(), succeeded: vi.fn() };
vi.mock("./login-guard", () => ({ loginGuard: guard }));

const { APIError } = await import("better-auth/api");
const { changeOwnPassword } = await import("./change-password");

beforeEach(() => {
  vi.clearAllMocks();
  guard.attempt.mockResolvedValue(0);
  changePassword.mockResolvedValue({ token: "t" });
});

describe("changeOwnPassword", () => {
  it("rejects a bad new password before any ticket or password check", async () => {
    expect(await changeOwnPassword("rossi", "old", "")).toEqual({
      error: { key: "validation.passwordTooShort", values: { min: 1 } },
    });
    expect(await changeOwnPassword("rossi", "old", "x".repeat(129))).toMatchObject({
      error: { key: "validation.passwordTooLong" },
    });
    expect(await changeOwnPassword("rossi", "same", "same")).toEqual({
      error: { key: "settings.password.unchanged" },
    });
    expect(guard.attempt).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("verifies the current password through Better Auth and signs the other devices out", async () => {
    expect(await changeOwnPassword("rossi", "old", "new")).toEqual({ ok: true });
    expect(changePassword).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { currentPassword: "old", newPassword: "new", revokeOtherSessions: true },
    });
    expect(guard.succeeded).toHaveBeenCalledOnce();
  });

  it("throttles per person with its own key, apart from the sign-in lock", async () => {
    await changeOwnPassword("rossi", "old", "new");
    const key = guard.attempt.mock.calls[0]?.[0];
    expect(key).toContain("rossi");
    expect(key).not.toBe("rossi");
    expect(guard.attempt.mock.invocationCallOrder[0]).toBeLessThan(changePassword.mock.invocationCallOrder[0]!);
  });

  it("refuses without checking the password while the person is locked", async () => {
    guard.attempt.mockResolvedValue(30);
    expect(await changeOwnPassword("rossi", "old", "new")).toEqual({
      error: { key: "settings.password.tooMany" },
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("reports a wrong current password and keeps the ticket spent", async () => {
    changePassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Invalid password" }));
    expect(await changeOwnPassword("rossi", "bad", "new")).toEqual({
      error: { key: "settings.password.wrongCurrent" },
    });
    expect(guard.refund).not.toHaveBeenCalled();
    expect(guard.succeeded).not.toHaveBeenCalled();
  });

  it("refunds the ticket and rethrows when the failure was not a wrong password", async () => {
    const boom = new APIError("UNAUTHORIZED", { message: "Unauthorized" });
    changePassword.mockRejectedValue(boom);
    await expect(changeOwnPassword("rossi", "old", "new")).rejects.toBe(boom);
    expect(guard.refund).toHaveBeenCalledOnce();
  });
});
