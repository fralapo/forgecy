import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers";

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

describe("tracked files", () => {
  it.each([
    ["Redis dumps", /\.rdb$/],
    ["Python wheels", /\.whl$/],
    ["secret env files", /(^|\/)\.env(\.(?!example$)[^/]+)?$/],
  ])("tracks no %s", (_label, pattern) => {
    expect(tracked.filter((f) => pattern.test(f))).toEqual([]);
  });
});
