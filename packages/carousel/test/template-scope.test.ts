import { describe, expect, it } from "vitest";
import { templatesVisibleTo } from "../src/catalog";

const rows = [
  { id: "agency", clientId: null },
  { id: "mine", clientId: "c1" },
  { id: "theirs", clientId: "c2" },
];

describe("templatesVisibleTo", () => {
  it("shows agency templates and the client's own, never another client's", () => {
    expect(templatesVisibleTo(rows, "c1").map((r) => r.id)).toEqual(["agency", "mine"]);
    expect(templatesVisibleTo(rows, "c2").map((r) => r.id)).toEqual(["agency", "theirs"]);
  });
  it("shows only agency templates when there is no client", () => {
    expect(templatesVisibleTo(rows, null).map((r) => r.id)).toEqual(["agency"]);
  });
});
