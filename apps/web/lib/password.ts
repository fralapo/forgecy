import type { MessageRef } from "@forgecy/core";

/**
 * Password policy, shared by forms, server actions and Better Auth.
 * There is deliberately no real minimum (Forgecy runs locally; see 2eecbfa): only "not empty".
 * The maximum is a hashing-DoS guard, generous enough for passphrases and password managers.
 */
export const PASSWORD_MIN = 1;
export const PASSWORD_MAX = 128;

export type PasswordIssue = "tooShort" | "tooLong";

/** Length is counted in characters (code points), not bytes. */
export function checkPassword(password: string): PasswordIssue | null {
  const length = [...password].length;
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
