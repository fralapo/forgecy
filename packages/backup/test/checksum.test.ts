import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileSha256 } from "../src/archive";
import { checksumMatches } from "../src/restore";

// Pure (no tar, no pg_dump): runs on every host.
describe("checksumMatches", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "forgecy-sum-"));
    file = join(dir, "b.tar.gz");
    writeFileSync(file, "archive bytes");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("passes when the recorded checksum matches, or none was recorded", async () => {
    expect(await checksumMatches(file)).toBe(true); // no sidecar
    writeFileSync(`${file}.json`, JSON.stringify({}));
    expect(await checksumMatches(file)).toBe(true); // sidecar without sha256
    writeFileSync(`${file}.json`, JSON.stringify({ sha256: await fileSha256(file) }));
    expect(await checksumMatches(file)).toBe(true);
  });

  it("fails when the bytes no longer match the recorded checksum", async () => {
    writeFileSync(`${file}.json`, JSON.stringify({ sha256: "0".repeat(64) }));
    expect(await checksumMatches(file)).toBe(false);
  });
});
