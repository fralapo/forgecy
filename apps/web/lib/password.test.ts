import { describe, expect, it } from "vitest";
import { checkPassword, checkPasswordChange, PASSWORD_MAX, PASSWORD_MIN, passwordIssueRef } from "./password";

describe("checkPassword", () => {
  it("keeps the maintainer's minimum of 1 and caps at 128", () => {
    expect(PASSWORD_MIN).toBe(1);
    expect(PASSWORD_MAX).toBe(128);
  });

  it("rejects the empty password but accepts short ones", () => {
    expect(checkPassword("")).toBe("tooShort");
    expect(checkPassword("a")).toBeNull();
    expect(checkPassword("1234")).toBeNull();
    expect(checkPassword("password")).toBeNull();
  });

  it("rejects over-long passwords but accepts exactly the maximum", () => {
    expect(checkPassword("a1".repeat(64) + "x")).toBe("tooLong"); // 129
    expect(checkPassword("Zq7!".repeat(32))).toBeNull(); // 128
  });

  it("counts UTF-16 units like Better Auth sign-in and the HTML maxLength, not bytes", () => {
    expect(checkPassword("ä".repeat(128))).toBeNull(); // 128 units, 256 bytes
    expect(checkPassword("ä".repeat(129))).toBe("tooLong");
    expect(checkPassword("😀".repeat(64))).toBeNull(); // 64 code points, 128 units
    expect(checkPassword("😀".repeat(65))).toBe("tooLong"); // 130 units: sign-in would reject it
  });
});

describe("passwordIssueRef", () => {
  it("maps every issue to a message key", () => {
    expect(passwordIssueRef("tooShort")).toEqual({ key: "validation.passwordTooShort", values: { min: 1 } });
    expect(passwordIssueRef("tooLong")).toEqual({ key: "validation.passwordTooLong", values: { max: 128 } });
  });
});

describe("checkPasswordChange", () => {
  it("applies the shared policy to the new password", () => {
    expect(checkPasswordChange("old", "")).toBe("tooShort");
    expect(checkPasswordChange("old", "x".repeat(129))).toBe("tooLong");
  });
  it("refuses to reuse the current password", () => {
    expect(checkPasswordChange("same", "same")).toBe("unchanged");
  });
  it("accepts a different password of any allowed length", () => {
    expect(checkPasswordChange("old", "a")).toBeNull();
  });
});
