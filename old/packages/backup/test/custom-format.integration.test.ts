/**
 * ADR 0019: backups carry a `pg_dump --format=custom` archive restored by pg_restore, after the
 * scanner has read the archive's SQL rendering. Scratch databases are created and dropped on the
 * FORGECY_TEST_DATABASE_URL server; needs psql, pg_dump and pg_restore 17+ on PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "@forgecy/db/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  backupPath,
  createBackupArchive,
  pgDumpTo,
  pgRestoreInto,
  psqlLoadInto,
  restoreArchive,
  tarArgs,
  UnsafeDumpError,
} from "../src";
import { hasPgTools, psql, testDatabaseUrl, withDb } from "./pg-tools";

const DB = "forgecy_custom_format_test";
const HOSTILE_DB = "forgecy_custom_format_hostile_test";

describe.skipIf(!testDatabaseUrl || !hasPgTools)("custom-format backups (integration)", () => {
  const admin = testDatabaseUrl ?? "postgres://skipped@localhost/skipped";
  const scratch = withDb(admin, DB);
  const hostile = withDb(admin, HOSTILE_DB);
  const agency = () =>
    psql(scratch, `SELECT value->>'name' FROM app_settings WHERE key = 'agency'`);
  let dataDir: string;
  let mediaDir: string;

  const cleanup = () => {
    psql(admin, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    psql(admin, `DROP DATABASE IF EXISTS ${HOSTILE_DB} WITH (FORCE)`);
  };

  beforeAll(async () => {
    cleanup();
    psql(admin, `CREATE DATABASE ${DB}`);
    await applyMigrations(scratch);
    psql(scratch, `INSERT INTO app_settings (key, value) VALUES ('agency', '{"name":"Before"}')`);
    dataDir = mkdtempSync(join(tmpdir(), "forgecy-custom-format-"));
    mediaDir = join(dataDir, "media");
    mkdirSync(mediaDir, { recursive: true });
  }, 120_000);

  afterAll(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    cleanup();
  });

  it("round-trips a pg_dump --format=custom of the migrated schema through pg_restore", async () => {
    const { name } = await createBackupArchive({
      dataDir,
      mediaDir,
      kind: "manual",
      dump: pgDumpTo(scratch),
    });
    const entries = execFileSync("tar", tarArgs(["-tzf", backupPath(dataDir, name)]), {
      encoding: "utf8",
    });
    expect(entries).toContain("db.dump");
    expect(entries).not.toContain("db.sql");
    psql(scratch, `UPDATE app_settings SET value = '{"name":"After"}' WHERE key = 'agency'`);
    psql(scratch, `CREATE TABLE made_after_the_backup (id int)`);
    const loaded: string[] = [];
    await restoreArchive({
      dataDir,
      mediaDir,
      name,
      load: async (f) => void loaded.push(f),
      loadArchive: pgRestoreInto(scratch),
    });
    expect(loaded).toEqual([]);
    expect(agency()).toBe("Before");
    // --clean drops what the dump holds; it does not touch objects it does not know.
    expect(psql(scratch, `SELECT to_regclass('public.made_after_the_backup') IS NOT NULL`)).toBe(
      "t",
    );
    expect(psql(scratch, `SELECT count(*) > 0 FROM drizzle.__drizzle_migrations`)).toBe("t");
  }, 120_000);

  it("refuses an archive whose SQL the scanner rejects before pg_restore connects", async () => {
    // A table name that makes pg_dump write a COPY header the scanner reads as a COPY ...
    // TO PROGRAM-like statement; harmless to pg_restore itself, but nothing is proven safe.
    psql(admin, `CREATE DATABASE ${HOSTILE_DB}`);
    psql(
      hostile,
      `CREATE TABLE "x) TO PROGRAM 'id'; --" (c int); INSERT INTO "x) TO PROGRAM 'id'; --" VALUES (1)`,
    );
    const { name } = await createBackupArchive({
      dataDir,
      mediaDir,
      kind: "manual",
      dump: pgDumpTo(hostile),
    });
    psql(scratch, `UPDATE app_settings SET value = '{"name":"Untouched"}' WHERE key = 'agency'`);
    const calls: string[] = [];
    await expect(
      restoreArchive({
        dataDir,
        mediaDir,
        name,
        load: async (f) => void calls.push(f),
        loadArchive: async (archive, list) => {
          calls.push(archive);
          await pgRestoreInto(scratch)(archive, list);
        },
      }),
    ).rejects.toThrow(UnsafeDumpError);
    await expect(
      restoreArchive({
        dataDir,
        mediaDir,
        name,
        load: async () => {},
        loadArchive: async () => {},
      }),
    ).rejects.toThrow(/COPY other than FROM stdin/);
    expect(calls).toEqual([]);
    expect(agency()).toBe("Untouched");
    expect(psql(scratch, `SELECT count(*) FROM pg_tables WHERE tablename LIKE 'x)%'`)).toBe("0");
  }, 120_000);

  it("still restores a plain-SQL backup (format 1) with psql", async () => {
    const { name } = await createBackupArchive({
      dataDir,
      mediaDir,
      kind: "manual",
      dump: pgDumpTo(scratch, "plain"),
    });
    psql(scratch, `UPDATE app_settings SET value = '{"name":"Changed"}' WHERE key = 'agency'`);
    await restoreArchive({
      dataDir,
      mediaDir,
      name,
      load: psqlLoadInto(scratch),
      loadArchive: async () => {
        throw new Error("a plain backup never goes through pg_restore");
      },
    });
    expect(agency()).toBe("Untouched");
  }, 120_000);
});
