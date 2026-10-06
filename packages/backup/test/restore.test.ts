import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupsDir,
  createBackupArchive,
  inspectBackup,
  readRestoreStatus,
  restoreArchive,
  restoreInProgress,
  writeRestoreStatus,
} from "../src";

const shipped = [{ tag: "0000_a" }, { tag: "0001_b" }, { tag: "0002_c" }];

describe("restore", () => {
  let dataDir: string;
  let mediaDir: string;
  const dump = async (file: string) => writeFileSync(file, "select 1;\n");

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "forgecy-restore-test-"));
    mediaDir = join(dataDir, "media");
    mkdirSync(join(mediaDir, "system"), { recursive: true });
    writeFileSync(join(mediaDir, "system", "a.txt"), "before");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const make = (lastMigration: string | null) =>
    createBackupArchive({ dataDir, mediaDir, dump, kind: "manual", lastMigration });

  it("accepts a backup from this version and counts the migrations to apply", async () => {
    const { name } = await make("0000_a");
    const res = await inspectBackup(dataDir, name, shipped);
    expect(res.problems).toEqual([]);
    expect(res.migrationsToApply).toBe(2);
    expect(res.manifest?.media).toBe(true);
  });

  it("refuses a backup from a newer version and an unreadable file", async () => {
    const { name } = await make("0009_future");
    expect((await inspectBackup(dataDir, name, shipped)).problems).toEqual(["newer_version"]);
    const broken = "forgecy-2026-01-01T00-00-00-000Z.tar.gz";
    writeFileSync(join(backupsDir(dataDir), broken), "not an archive");
    expect((await inspectBackup(dataDir, broken, shipped)).problems).toEqual(["unreadable"]);
  });

  it("loads the dump and copies the media back", async () => {
    const { name } = await make("0002_c");
    writeFileSync(join(mediaDir, "system", "a.txt"), "after");
    const loaded: string[] = [];
    const res = await restoreArchive({
      dataDir,
      mediaDir,
      name,
      load: async (file) => void loaded.push(readFileSync(file, "utf8")),
    });
    expect(res.media).toBe(true);
    expect(loaded).toEqual(["select 1;\n"]);
    expect(readFileSync(join(mediaDir, "system", "a.txt"), "utf8")).toBe("before");
  });

  it("keeps the status on disk and ignores a restore silent for hours", async () => {
    expect(await readRestoreStatus(dataDir)).toBeNull();
    await writeRestoreStatus(dataDir, {
      state: "running",
      backup: "x.tar.gz",
      requestedBy: "Laura",
      requestedAt: new Date().toISOString(),
    });
    const status = await readRestoreStatus(dataDir);
    expect(restoreInProgress(status)).toBe(true);
    expect(restoreInProgress(status, new Date(Date.now() + 3 * 3_600_000))).toBe(false);
    expect(restoreInProgress({ ...status!, state: "completed" })).toBe(false);
  });
});
