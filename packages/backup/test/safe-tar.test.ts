import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tarGz } from "@forgecy/core/testing/archives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertPlainTree,
  extractBackupArchive,
  isPlainTarEntry,
  UnsafeArchiveError,
} from "../src/safe-tar";

describe("isPlainTarEntry", () => {
  it("accepts files and directories and refuses everything else (GNU and bsdtar listings)", () => {
    expect(isPlainTarEntry("-rw-r--r-- u/g 3 2026-10-08 10:00 media/a.txt")).toBe(true);
    expect(isPlainTarEntry("drwxr-xr-x u/g 0 2026-10-08 10:00 media/")).toBe(true);
    expect(isPlainTarEntry("-rw-r--r--  0 u g 3 Oct  8 10:00 media/a.txt")).toBe(true);
    expect(isPlainTarEntry("lrwxrwxrwx u/g 0 2026-10-08 10:00 m/x -> /etc/passwd")).toBe(false);
    expect(isPlainTarEntry("hrw-r--r-- u/g 0 2026-10-08 10:00 m/y link to m/a")).toBe(false);
    expect(isPlainTarEntry("crw-rw-rw- r/r 1,3 2026-10-08 10:00 m/null")).toBe(false);
    expect(isPlainTarEntry("prw-r--r-- u/g 0 2026-10-08 10:00 m/fifo")).toBe(false);
  });
});

describe("assertPlainTree", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "forgecy-tree-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("accepts plain files and folders", async () => {
    mkdirSync(join(dir, "media", "a"), { recursive: true });
    writeFileSync(join(dir, "media", "a", "x.txt"), "x");
    await expect(assertPlainTree(dir)).resolves.toBeUndefined();
  });

  it("refuses a symlink anywhere in the tree", async () => {
    mkdirSync(join(dir, "media"), { recursive: true });
    try {
      symlinkSync(join(dir, "elsewhere"), join(dir, "media", "evil"), "dir");
    } catch {
      return; // Windows without symlink privilege: covered by the tar end-to-end test on Linux.
    }
    await expect(assertPlainTree(dir)).rejects.toBeInstanceOf(UnsafeArchiveError);
  });
});

const hasTar = process.platform !== "win32" && spawnSync("tar", ["--version"]).status === 0;

describe.skipIf(!hasTar)("extractBackupArchive with the system tar", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "forgecy-tar-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, data: Buffer) => {
    const file = join(dir, name);
    writeFileSync(file, data);
    return file;
  };

  it("extracts a plain archive", async () => {
    const file = write(
      "ok.tar.gz",
      tarGz([
        { name: "manifest.json", data: "{}" },
        { name: "media", type: "dir" },
        { name: "media/a.txt", data: "a" },
      ]),
    );
    const work = join(dir, "work");
    mkdirSync(work);
    await extractBackupArchive(file, work);
    expect(existsSync(join(work, "media", "a.txt"))).toBe(true);
  });

  it.each([
    ["symlink", { name: "media/evil", type: "symlink", linkName: "/etc/passwd" } as const],
    ["hardlink", { name: "media/evil", type: "hardlink", linkName: "media/a.txt" } as const],
    ["device", { name: "media/dev", type: "char" } as const],
  ])("refuses an archive with a %s before extracting anything", async (_kind, entry) => {
    const file = write("bad.tar.gz", tarGz([{ name: "media/a.txt", data: "a" }, entry]));
    const work = join(dir, "work");
    mkdirSync(work);
    await expect(extractBackupArchive(file, work)).rejects.toBeInstanceOf(UnsafeArchiveError);
    expect(existsSync(join(work, "media", "a.txt"))).toBe(false);
  });

  it("does not write outside the work folder for a ../ member", async () => {
    const file = write("dots.tar.gz", tarGz([{ name: "../escaped.txt", data: "x" }]));
    const work = join(dir, "work");
    mkdirSync(work);
    await expect(extractBackupArchive(file, work)).rejects.toThrow();
    expect(existsSync(join(dir, "escaped.txt"))).toBe(false);
  });

  it("extracts only the named members when asked (manifest peek)", async () => {
    const file = write(
      "peek.tar.gz",
      tarGz([
        { name: "manifest.json", data: "{}" },
        { name: "db.sql", data: "select 1;" },
      ]),
    );
    const work = join(dir, "work");
    mkdirSync(work);
    await extractBackupArchive(file, work, ["manifest.json"]);
    expect(existsSync(join(work, "manifest.json"))).toBe(true);
    expect(existsSync(join(work, "db.sql"))).toBe(false);
  });
});
