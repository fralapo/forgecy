import { describe, expect, it } from "vitest";
import { compareVersions } from "../src/catalog";

const sorted = (versions: string[]) => [...versions].sort(compareVersions);

describe("compareVersions", () => {
  it("orders plain versions numerically", () => {
    expect(sorted(["1.10.0", "1.9.3", "1.2.0"])).toEqual(["1.2.0", "1.9.3", "1.10.0"]);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });
  it("puts a prerelease before the release it belongs to, and after the one before", () => {
    expect(sorted(["1.0.0", "1.0.0-import.1", "0.9.0"])).toEqual([
      "0.9.0",
      "1.0.0-import.1",
      "1.0.0",
    ]);
  });
  it("orders prerelease numbers numerically, as semver does", () => {
    expect(sorted(["1.0.0-import.10", "1.0.0-import.2", "1.0.0-import.1"])).toEqual([
      "1.0.0-import.1",
      "1.0.0-import.2",
      "1.0.0-import.10",
    ]);
  });
  it("never answers NaN", () => {
    for (const [a, b] of [
      ["1.0.0-import.1", "1.0.0"],
      ["1.0.0", "1.0.0-import.1"],
      ["1.0.0-import.1", "1.0.1"],
    ] as const)
      expect(Number.isNaN(compareVersions(a!, b!))).toBe(false);
  });
});
