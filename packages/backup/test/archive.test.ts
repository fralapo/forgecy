import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupPath,
  createBackupArchive,
  deleteBackup,
  isBackupName,
  listBackups,
  pruneExpiredBackups,
} from "../src";

describe("backup archives", () => {
  let dataDir: string;
  let mediaDir: string;
  const dump = async (file: string) => writeFileSync(file, "select 1;\n");

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "forgecy-backup-test-"));
    mediaDir = join(dataDir, "media");
    mkdirSync(join(mediaDir, "system", "assets"), { recursive: true });
    writeFileSync(join(mediaDir, "system", "assets", "a.txt"), "hello");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("writes the dump, manifest and media, and lists it with its metadata", async () => {
    const created = await createBackupArchive({
      dataDir,
      mediaDir,
      dump,
      kind: "manual",
      createdBy: "user-1",
      appVersion: "0.1.0",
      lastMigration: "0011_x",
      now: new Date("2026-10-06T10:00:00Z"),
    });
    expect(created.name).toBe("forgecy-2026-10-06T10-00-00-000Z.tar.gz");
    const entries = execFileSync("tar", ["-tzf", backupPath(dataDir, created.name)], {
      encoding: "utf8",
    });
    expect(entries).toContain("db.sql");
    expect(entries).toContain("manifest.json");
    expect(entries).toContain("media/system/assets/a.txt");
    const [listed] = await listBackups(dataDir);
    expect(listed).toMatchObject({
      name: created.name,
      kind: "manual",
      media: true,
      appVersion: "0.1.0",
      lastMigration: "0011_x",
      createdBy: "user-1",
      expiresAt: null,
    });
  });

  it("leaves no file behind when the dump fails", async () => {
    await expect(
      createBackupArchive({
        dataDir,
        mediaDir,
        kind: "manual",
        dump: async () => {
          throw new Error("pg_dump failed");
        },
      }),
    ).rejects.toThrow("pg_dump failed");
    expect(await listBackups(dataDir)).toEqual([]);
  });

  it("prunes only nightly backups past 30 days", async () => {
    const old = new Date("2026-08-01T02:00:00Z");
    await createBackupArchive({ dataDir, mediaDir, dump, kind: "nightly", now: old });
    await createBackupArchive({ dataDir, mediaDir, dump, kind: "manual", now: old });
    const pruned = await pruneExpiredBackups(dataDir, new Date("2026-10-06T00:00:00Z"));
    expect(pruned).toHaveLength(1);
    const left = await listBackups(dataDir);
    expect(left.map((b) => b.kind)).toEqual(["manual"]);
    await deleteBackup(dataDir, left[0]!.name);
    expect(await listBackups(dataDir)).toEqual([]);
  });

  it("refuses names outside the backups folder", () => {
    expect(isBackupName("forgecy-2026-10-06T10-00-00-000Z.tar.gz")).toBe(true);
    expect(isBackupName("../etc/passwd")).toBe(false);
    expect(isBackupName("forgecy-../../x.tar.gz")).toBe(false);
    expect(() => backupPath(dataDir, "../../x.tar.gz")).toThrow();
  });
});
