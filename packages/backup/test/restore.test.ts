import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BackupInvalidError,
  backupsDir,
  createBackupArchive,
  inspectBackup,
  listBackups,
  readRestoreStatus,
  restoreArchive,
  restoreInProgress,
  saveUploadedBackup,
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

  it("refuses a backup whose bytes no longer match its recorded checksum", async () => {
    const { name } = await make("0001_b");
    const sidecar = join(backupsDir(dataDir), `${name}.json`);
    const meta = JSON.parse(readFileSync(sidecar, "utf8")) as { sha256: string };
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(sidecar, JSON.stringify({ ...meta, sha256: "0".repeat(64) }));
    expect((await inspectBackup(dataDir, name, shipped)).problems).toEqual(["checksum_mismatch"]);
  });

  it("refuses a backup from a newer version and an unreadable file", async () => {
    const { name } = await make("0009_future");
    expect((await inspectBackup(dataDir, name, shipped)).problems).toEqual(["newer_version"]);
    const broken = "forgecy-2026-01-01T00-00-00-000Z.tar.gz";
    writeFileSync(join(backupsDir(dataDir), broken), "not an archive");
    expect((await inspectBackup(dataDir, broken, shipped)).problems).toEqual(["unreadable"]);
  });

  it("keeps an uploaded backup with its own date and refuses anything else", async () => {
    const { name, createdAt } = await make("0001_b");
    const elsewhere = mkdtempSync(join(tmpdir(), "forgecy-upload-src-"));
    const copy = join(elsewhere, "from-another-machine.tar.gz");
    writeFileSync(copy, readFileSync(join(backupsDir(dataDir), name)));
    const now = new Date("2026-10-07T08:00:00Z");
    const saved = await saveUploadedBackup(dataDir, createReadStream(copy), {
      now,
      uploadedBy: "user-1",
    });
    expect(saved).toMatchObject({ kind: "upload", createdBy: "user-1", expiresAt: null });
    expect(saved.name).toMatch(/^forgecy-upload-2026-10-07T08-00-00-000Z\.tar\.gz$/);
    const listed = (await listBackups(dataDir)).find((b) => b.name === saved.name);
    expect(listed).toMatchObject({ kind: "upload", lastMigration: "0001_b" });
    expect(listed?.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect((await inspectBackup(dataDir, saved.name, shipped)).problems).toEqual([]);

    await expect(
      saveUploadedBackup(dataDir, Readable.from([Buffer.from("not an archive")]), { now }),
    ).rejects.toBeInstanceOf(BackupInvalidError);
    // Nothing of the refused file is left behind.
    expect(readdirSync(backupsDir(dataDir)).filter((f) => f.includes("upload")).length).toBe(2);
    expect(existsSync(join(backupsDir(dataDir), `${saved.name}.partial`))).toBe(false);
    rmSync(elsewhere, { recursive: true, force: true });
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
