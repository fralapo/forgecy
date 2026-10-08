import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { refinePassword } = await import("./password-schema");

function issuesFor(password: string) {
  const issues: { path: unknown; message: string }[] = [];
  refinePassword({ password }, { addIssue: (i: { path: unknown; message: string }) => issues.push(i) } as never);
  return issues;
}

describe("refinePassword", () => {
  it("adds nothing for an acceptable password", () => {
    expect(issuesFor("a")).toEqual([]);
  });

  it("reports empty and over-long passwords on the password field", () => {
    expect(issuesFor("")).toMatchObject([{ path: ["password"], message: expect.stringContaining("validation.passwordTooShort") }]);
    expect(issuesFor("x".repeat(129))).toMatchObject([{ path: ["password"], message: expect.stringContaining("validation.passwordTooLong") }]);
  });
});
