import { describe, expect, it } from "vitest";
import { isValidUsername, usernameToEmail } from "./username";

// Better Auth refuses at sign-in (z.email) what these accepted at account creation: on a
// fresh install "admin." created the Admin, then nobody could ever sign in.
// validation.usernameInvalid describes exactly these rules: only dots are restricted (not
// first, not last, never two in a row); dashes and underscores may go anywhere.
describe("isValidUsername", () => {
  it.each([
    "admin",
    "jo.doe",
    "anna_rossi",
    "x-y",
    "a_b-c",
    "a--b",
    "a__b",
    "-admin",
    "admin_",
    "anna@studio.it",
    "Anna@Studio.it",
  ])("accepts %s", (u) => {
    expect(isValidUsername(u)).toBe(true);
  });

  it.each([
    "admin.",
    ".admin",
    "a..b",
    "admin.@forgecy.local",
    ".admin@forgecy.local",
    "a..b@studio.it",
    "admin@corp",
    "admin@-x.com",
    "anna+x@studio.it",
    "o'brien@studio.it",
    "",
    "has space",
    "a/b",
  ])("refuses %j", (u) => {
    expect(isValidUsername(u)).toBe(false);
  });

  it("stores a bare username under the local domain", () => {
    expect(usernameToEmail(" Jo.Doe ")).toBe("jo.doe@forgecy.local");
  });
});
