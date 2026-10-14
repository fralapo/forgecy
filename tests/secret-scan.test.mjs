import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("tracked secret scan handles files deleted from the working tree", () => {
  const root = mkdtempSync(join(tmpdir(), "forgecy-secret-scan-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    git("init", "-q");
    git("config", "user.name", "Forgecy test");
    git("config", "user.email", "forgecy-test@example.invalid");
    writeFileSync(join(root, "tracked.txt"), "safe content\n");
    git("add", "tracked.txt");
    git("commit", "-m", "fixture");
    rmSync(join(root, "tracked.txt"));

    const scanner = resolve("scripts/secret-scan.mjs");
    const result = spawnSync(process.execPath, [scanner, "--tracked"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Secret scan passed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
