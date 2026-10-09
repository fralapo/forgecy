import { createFakeDb } from "@forgecy/db/testing";
import { describe, expect, it } from "vitest";
import { jobVisibleTo } from "../src";

const ID = "00000000-0000-4000-8000-000000000001";
const user = {
  type: "user" as const,
  id: "u1",
  isAdmin: false,
  active: true,
  clients: "all" as const,
};
const admin = { ...user, isAdmin: true };

describe("jobVisibleTo", () => {
  it("is false for an unknown id (same answer as a hidden job)", async () => {
    expect(await jobVisibleTo(createFakeDb({ selects: [[]] }).db, user, ID)).toBe(false);
  });

  it("hides an Admin job from a non-admin and shows it to the Admin", async () => {
    const row = [{ kind: "system.backup", clientId: null }];
    expect(await jobVisibleTo(createFakeDb({ selects: [row] }).db, user, ID)).toBe(false);
    expect(await jobVisibleTo(createFakeDb({ selects: [row] }).db, admin, ID)).toBe(true);
  });

  it("shows an ordinary job to any active person", async () => {
    const row = [{ kind: "content.export", clientId: "c1" }];
    expect(await jobVisibleTo(createFakeDb({ selects: [row] }).db, user, ID)).toBe(true);
  });

  it("hides the job of a client the person is not assigned to (ADR 0020)", async () => {
    const row = [{ kind: "content.export", clientId: "c1" }];
    const member = { ...user, clients: ["c2"] };
    expect(await jobVisibleTo(createFakeDb({ selects: [row] }).db, member, ID)).toBe(false);
    expect(
      await jobVisibleTo(createFakeDb({ selects: [row] }).db, { ...member, clients: ["c1"] }, ID),
    ).toBe(true);
  });
});
