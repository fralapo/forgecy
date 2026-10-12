import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupDbFormat,
  backupPath,
  createBackupArchive,
  deleteBackup,
  isBackupName,
  listBackups,
  pgRestoreArgs,
  pruneExpiredBackups,
  tarArgs,
  type DbDump,
} from "../src";

describe("backupDbFormat", () => {
  it("reads a manifest without `db` (every backup made before custom dumps) as plain SQL", () => {
    expect(backupDbFormat({ format: 1 })).toBe("plain");
    expect(backupDbFormat({ format: 1, db: "plain" })).toBe("plain");
  });
  it("reads a format 2 manifest as a custom-format dump", () => {
    expect(backupDbFormat({ format: 2, db: "custom" })).toBe("custom");
  });
  it("refuses a manifest whose format and dump type disagree, or that it does not know", () => {
    for (const m of [
      { format: 1, db: "custom" },
      { format: 2 },
      { format: 2, db: "plain" },
      { format: 3, db: "custom" },
      { format: "1" },
      { format: 2, db: "../../etc/passwd" },
      { format: 2, db: "constructor" },
      { format: 1, db: "__proto__" },
      { format: 2, db: ["custom"] },
    ])
      expect(() => backupDbFormat(m as never), JSON.stringify(m)).toThrow(/Unsupported backup/);
  });
});

describe("pgRestoreArgs", () => {
  it("renders to SQL with the same options it restores with, minus the connection and the transaction", () => {
    expect(pgRestoreArgs("a.dump", { file: "-" })).toEqual([
      "--clean",
      "--if-exists",
      "--no-owner",
      "--file",
      "-",
      "a.dump",
    ]);
    expect(pgRestoreArgs("a.dump", { list: "a.list", databaseUrl: "postgres://x" })).toEqual([
      "--clean",
      "--if-exists",
      "--no-owner",
      "--use-list",
      "a.list",
      "--single-transaction",
      "--exit-on-error",
      "--dbname",
      "postgres://x",
      "a.dump",
    ]);
  });
});

describe("tarArgs", () => {
  const call = ["-xzf", "C:\\data\\b.tar.gz", "-C", "C:\\work", "manifest.json"];
  it("adds --force-local for GNU tar only, so a drive path is never read as a remote host", () => {
    expect(tarArgs(call, { gnu: true, windows: false })).toEqual(["--force-local", ...call]);
    expect(tarArgs(call, { gnu: false, windows: false })).toEqual(call);
    expect(tarArgs(call, { gnu: false, windows: true })).not.toContain("--force-local");
  });
  it("gives paths with forward slashes on Windows only (a backslash is a file name character elsewhere)", () => {
    expect(tarArgs(call, { gnu: true, windows: true })).toEqual([
      "--force-local",
      "-xzf",
      "C:/data/b.tar.gz",
      "-C",
      "C:/work",
      "manifest.json",
    ]);
    expect(tarArgs(call, { gnu: false, windows: true })).toEqual([
      "-xzf",
      "C:/data/b.tar.gz",
      "-C",
      "C:/work",
      "manifest.json",
    ]);
  });
});

describe("backup archives", () => {
  let dataDir: string;
  let mediaDir: string;
  const dump: DbDump = {
    format: "plain",
    write: async (file) => writeFileSync(file, "select 1;\n"),
  };

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
    const entries = execFileSync("tar", tarArgs(["-tzf", backupPath(dataDir, created.name)]), {
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

  it("stores a custom-format dump as db.dump, marked in the manifest and the sidecar", async () => {
    const created = await createBackupArchive({
      dataDir,
      mediaDir,
      dump: { format: "custom", write: async (file) => writeFileSync(file, "PGDMP-bytes") },
      kind: "manual",
      includeMedia: false,
    });
    const file = backupPath(dataDir, created.name);
    const entries = execFileSync("tar", tarArgs(["-tzf", file]), { encoding: "utf8" });
    expect(entries.split(/\r?\n/).filter(Boolean).sort()).toEqual(["db.dump", "manifest.json"]);
    const manifest = JSON.parse(
      execFileSync("tar", tarArgs(["-xzOf", file, "manifest.json"]), { encoding: "utf8" }),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({ format: 2, db: "custom" });
    expect(JSON.parse(readFileSync(`${file}.json`, "utf8"))).toMatchObject({
      format: 2,
      db: "custom",
    });
  });

  it("keeps writing a plain dump exactly as before (format 1, db.sql)", async () => {
    const created = await createBackupArchive({ dataDir, mediaDir, dump, kind: "manual" });
    const file = backupPath(dataDir, created.name);
    const manifest = JSON.parse(
      execFileSync("tar", tarArgs(["-xzOf", file, "manifest.json"]), { encoding: "utf8" }),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({ format: 1 });
    expect(manifest.db).toBeUndefined();
    expect(execFileSync("tar", tarArgs(["-tzf", file]), { encoding: "utf8" })).toContain("db.sql");
  });

  it("leaves no file behind when the dump fails", async () => {
    await expect(
      createBackupArchive({
        dataDir,
        mediaDir,
        kind: "manual",
        dump: {
          format: "custom",
          write: async () => {
            throw new Error("pg_dump failed");
          },
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
