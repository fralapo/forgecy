import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileSha256 } from "../src/archive";
import { checksumMatches } from "../src/restore";

// Lets one test make the sidecar read fail with a permission error; otherwise the real readFile.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

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

  it("passes when there is no sidecar at all (a backup copied in by hand)", async () => {
    expect(await checksumMatches(file)).toBe(true);
  });

  it("passes when the recorded checksum matches", async () => {
    writeFileSync(`${file}.json`, JSON.stringify({ sha256: await fileSha256(file) }));
    expect(await checksumMatches(file)).toBe(true);
  });

  it("fails when the bytes no longer match the recorded checksum", async () => {
    writeFileSync(`${file}.json`, JSON.stringify({ sha256: "0".repeat(64) }));
    expect(await checksumMatches(file)).toBe(false);
  });

  it("fails closed on a malformed sidecar", async () => {
    writeFileSync(`${file}.json`, "{ not json");
    expect(await checksumMatches(file)).toBe(false);
    writeFileSync(`${file}.json`, "null");
    expect(await checksumMatches(file)).toBe(false);
  });

  it("fails closed on a sidecar without a hash", async () => {
    writeFileSync(`${file}.json`, JSON.stringify({ format: 1 }));
    expect(await checksumMatches(file)).toBe(false);
    writeFileSync(`${file}.json`, JSON.stringify({ sha256: "" }));
    expect(await checksumMatches(file)).toBe(false);
  });

  it("fails closed when the sidecar cannot be read for a reason other than missing", async () => {
    mkdirSync(`${file}.json`); // a folder in its place: EISDIR, a real read error
    expect(await checksumMatches(file)).toBe(false);
  });

  it("fails closed on a permission error", async () => {
    writeFileSync(`${file}.json`, JSON.stringify({ sha256: await fileSha256(file) }));
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), { code: "EACCES" }),
    );
    expect(await checksumMatches(file)).toBe(false);
    expect(await checksumMatches(file)).toBe(true); // the mock was single-use
  });
});
