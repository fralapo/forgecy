import { describe, expect, it } from "vitest";
import { describeEvent, postUrl } from "./events";

describe("describeEvent", () => {
  it("keeps numbers as numbers", () => {
    expect(describeEvent({ type: "followers", old: "100", new: "112" })).toEqual({
      key: "followers",
      numeric: true,
    });
  });
  it("tells added, removed and changed text apart", () => {
    expect(describeEvent({ type: "biography", old: null, new: "Hi" }).key).toBe("biography.added");
    expect(describeEvent({ type: "biography", old: "Hi", new: null }).key).toBe(
      "biography.removed",
    );
    expect(describeEvent({ type: "category", old: "A", new: "B" }).key).toBe("category.changed");
  });
  it("reads visibility from the new value", () => {
    expect(describeEvent({ type: "visibility", old: "public", new: "private" }).key).toBe(
      "visibility.private",
    );
    expect(describeEvent({ type: "visibility", old: "private", new: "public" }).key).toBe(
      "visibility.public",
    );
  });
  it("falls back for an unknown type", () => {
    expect(describeEvent({ type: "nope", old: null, new: null }).key).toBe("other");
  });
});

describe("postUrl", () => {
  it("links a shortcode and not a numeric id", () => {
    expect(postUrl("Cx1_a-B")).toBe("https://www.instagram.com/p/Cx1_a-B/");
    expect(postUrl("17912345678901234")).toBeNull();
    expect(postUrl(null)).toBeNull();
  });
});
