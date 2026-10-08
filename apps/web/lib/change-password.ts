import "server-only";
import type { MessageRef } from "@forgecy/core";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { auth } from "./auth";
import { loginGuard } from "./login-guard";
import { checkPasswordChange, passwordIssueRef } from "./password";

export type ChangePasswordResult = { ok: true } | { error: MessageRef };

/**
 * Changes the signed-in person's own password. Better Auth checks the current one and signs the other
 * devices out. Its per-IP limiter only sees HTTP requests, not this server-side call, so wrong guesses are
 * throttled here per person (own key, so it cannot lock the person out of sign-in), before the check.
 */
export async function changeOwnPassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const issue = checkPasswordChange(currentPassword, newPassword);
  if (issue === "unchanged") return { error: { key: "settings.password.unchanged" } };
  if (issue) return { error: passwordIssueRef(issue) };
  const key = `change-password:${username}`;
  if ((await loginGuard.attempt(key)) > 0) return { error: { key: "settings.password.tooMany" } };
  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: { currentPassword, newPassword, revokeOtherSessions: true },
    });
  } catch (err) {
    // A wrong password keeps its ticket; anything else never reached the check, so it is given back.
    if (err instanceof APIError && err.body?.code === "INVALID_PASSWORD")
      return { error: { key: "settings.password.wrongCurrent" } };
    await loginGuard.refund(key);
    throw err;
  }
  await loginGuard.succeeded(key);
  return { ok: true };
}
