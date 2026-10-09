import type { MessageRef } from "@forgecy/core";

/**
 * Password policy, shared by forms, server actions and Better Auth.
 * There is deliberately no real minimum (Forgecy runs locally; see 2eecbfa): only "not empty".
 * The maximum is a hashing-DoS guard, generous enough for passphrases and password managers.
 */
export const PASSWORD_MIN = 1;
export const PASSWORD_MAX = 128;

export type PasswordIssue = "tooShort" | "tooLong";

/**
 * Length is counted in UTF-16 units (`string.length`), not bytes or code points: this is exactly what
 * Better Auth checks on sign-in and what the HTML `maxLength` counts, so a password accepted here can always sign in.
 */
export function checkPassword(password: string): PasswordIssue | null {
  const length = password.length;
  if (length < PASSWORD_MIN) return "tooShort";
  if (length > PASSWORD_MAX) return "tooLong";
  return null;
}

/** The message (key and values) the interface shows for an issue. */
export function passwordIssueRef(issue: PasswordIssue): MessageRef {
  return issue === "tooShort"
    ? { key: "validation.passwordTooShort", values: { min: PASSWORD_MIN } }
    : { key: "validation.passwordTooLong", values: { max: PASSWORD_MAX } };
}

/** The change-password form's check: the shared policy for the new password, plus "not the same as before". */
export function checkPasswordChange(
  current: string,
  next: string,
): PasswordIssue | "unchanged" | null {
  return checkPassword(next) ?? (next === current ? "unchanged" : null);
}
