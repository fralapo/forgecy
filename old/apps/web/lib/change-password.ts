import "server-only";
import type { MessageRef } from "@forgecy/core";
import { accounts, and, eq, getDb } from "@forgecy/db";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { auth } from "./auth";
import { checkPasswordChange, passwordIssueRef } from "./password";

export type ChangePasswordResult = { ok: true } | { error: MessageRef };

/** Whether the person signs in with a password (Google and magic-link people have no credential account). */
export async function hasPassword(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ password: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .limit(1);
  return Boolean(row?.password);
}

/**
 * Changes the signed-in person's own password. Better Auth checks the current one and signs the other
 * devices out.
 *
 * ponytail: wrong guesses are NOT throttled here. This server-side call bypasses Better Auth's rate limiter,
 * and the HTTP route (`POST /api/auth/change-password`) is protected only by its per-IP limit, so a stolen
 * session cookie could still guess the current password slowly. Add a per-person throttle on both paths
 * if that matters.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const issue = checkPasswordChange(currentPassword, newPassword);
  if (issue === "unchanged") return { error: { key: "settings.password.unchanged" } };
  if (issue) return { error: passwordIssueRef(issue) };
  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: { currentPassword, newPassword, revokeOtherSessions: true },
    });
  } catch (err) {
    if (err instanceof APIError) {
      const code = err.body?.code;
      if (code === "INVALID_PASSWORD") return { error: { key: "settings.password.wrongCurrent" } };
      if (code === "CREDENTIAL_ACCOUNT_NOT_FOUND")
        return { error: { key: "settings.password.noPassword" } };
    }
    throw err;
  }
  return { ok: true };
}
