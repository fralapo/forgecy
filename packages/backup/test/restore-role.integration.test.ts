/**
 * ADR 0018 round trip: a real pg_dump of the migrated schema, restored through restoreArchive
 * by a NOSUPERUSER role, into a scratch database this test creates and drops (with its role)
 * on the FORGECY_TEST_DATABASE_URL server. Needs psql and pg_dump 17+ on PATH as well.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "@forgecy/db/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSafeDumpText,
  createBackupArchive,
  pgDumpTo,
  psqlLoadInto,
  restoreArchive,
  restoreOwnershipSql,
  UnsafeDumpError,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const major = (tool: string) =>
  Number(/(\d+)\./.exec(spawnSync(tool, ["--version"], { encoding: "utf8" }).stdout ?? "")?.[1]);
const hasTools = major("psql") >= 17 && major("pg_dump") >= 17;

const ROLE = "forgecy_restore_role_test";
const DB = "forgecy_restore_role_test";

/** psql -c as `url`; returns stdout, throws with psql's stderr (never the URL). */
function psql(url: string, sql: string): string {
  const res = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", sql, url], {
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout.trim();
}

function withDb(url: string, db: string, user?: { name: string; password: string }): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user.name;
    u.password = user.password;
  }
  return u.toString();
}

describe.skipIf(!dbUrl || !hasTools)("restore as a least-privilege role (integration)", () => {
  // describe.skipIf still runs this body: a placeholder keeps URL parsing from throwing when skipped.
  const admin = dbUrl ?? "postgres://skipped@localhost/skipped";
  const password = randomBytes(18).toString("hex");
  const scratchAdmin = withDb(admin, DB);
  const scratchRestore = withDb(admin, DB, { name: ROLE, password });
  let dataDir: string;
  let mediaDir: string;

  const cleanup = () => {
    psql(admin, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    psql(admin, `DROP ROLE IF EXISTS ${ROLE}`);
  };

  beforeAll(async () => {
    cleanup();
    psql(
      admin,
      `CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    psql(admin, `CREATE DATABASE ${DB}`);
    // As in production: the superuser runs the migrations and owns everything they create.
    await applyMigrations(scratchAdmin);
    psql(
      scratchAdmin,
      `INSERT INTO app_settings (key, value) VALUES ('agency', '{"name":"Before"}')`,
    );
    dataDir = mkdtempSync(join(tmpdir(), "forgecy-restore-role-"));
    mediaDir = join(dataDir, "media");
    mkdirSync(mediaDir, { recursive: true });
  }, 120_000);

  afterAll(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    cleanup();
  });

  it("restores a pg_dump of the whole schema as the restricted role", async () => {
    const { name } = await createBackupArchive({
      dataDir,
      mediaDir,
      kind: "manual",
      dump: pgDumpTo(scratchAdmin),
    });
    psql(scratchAdmin, `UPDATE app_settings SET value = '{"name":"After"}' WHERE key = 'agency'`);
    // Without the ownership step the role cannot drop the superuser's tables.
    await expect(
      restoreArchive({
        dataDir,
        mediaDir,
        name,
        load: psqlLoadInto(scratchRestore),
        restricted: true,
      }),
    ).rejects.toThrow(/must be owner/);
    psql(scratchAdmin, restoreOwnershipSql(ROLE));
    // Without leaving out the extension lines: only a superuser may drop pgvector.
    await expect(
      restoreArchive({ dataDir, mediaDir, name, load: psqlLoadInto(scratchRestore) }),
    ).rejects.toThrow(/must be owner of extension vector/);
    await restoreArchive({
      dataDir,
      mediaDir,
      name,
      load: psqlLoadInto(scratchRestore),
      restricted: true,
    });
    expect(psql(scratchAdmin, `SELECT value->>'name' FROM app_settings WHERE key = 'agency'`)).toBe(
      "Before",
    );
    expect(
      psql(
        scratchAdmin,
        `SELECT string_agg(DISTINCT tableowner, ',') FROM pg_tables WHERE schemaname IN ('public', 'drizzle')`,
      ),
    ).toBe(ROLE);
    expect(psql(scratchAdmin, `SELECT extname FROM pg_extension WHERE extname = 'vector'`)).toBe(
      "vector",
    );
    expect(psql(admin, `SELECT rolsuper FROM pg_roles WHERE rolname = '${ROLE}'`)).toBe("f");
    // Migrations after the restore run as the superuser, so objects drift back to it: the
    // ownership step before each restore hands them over again.
    await applyMigrations(scratchAdmin);
    psql(scratchAdmin, `ALTER TABLE app_settings OWNER TO ${new URL(admin).username}`);
    psql(scratchAdmin, restoreOwnershipSql(ROLE));
    await restoreArchive({
      dataDir,
      mediaDir,
      name,
      load: psqlLoadInto(scratchRestore),
      restricted: true,
    });
  }, 120_000);

  it("refuses a superuser as the restore role", () => {
    expect(() => psql(scratchAdmin, restoreOwnershipSql(new URL(admin).username))).toThrow(
      /must be NOSUPERUSER/,
    );
  });

  it("COPY ... TO PROGRAM: refused by the scanner, and by the role where the scanner cannot see it", async () => {
    const program = "COPY (SELECT 1) TO PROGRAM 'id';\n";
    await expect(assertSafeDumpText(program)).rejects.toBeInstanceOf(UnsafeDumpError);
    expect(() => psql(scratchRestore, program)).toThrow(
      /permission denied to COPY to or from an external program/,
    );
    // Dynamic SQL is the scanner's documented residual: it passes, the role stops it.
    const hidden = "DO $x$ BEGIN EXECUTE 'COPY (SELECT 1) TO PROGRAM ''id'''; END $x$;\n";
    await expect(assertSafeDumpText(hidden)).resolves.toBeUndefined();
    expect(() => psql(scratchRestore, hidden)).toThrow(/permission denied to COPY/);
    expect(() => psql(scratchRestore, "COPY app_settings FROM '/etc/passwd'")).toThrow(
      /permission denied to COPY from a file/,
    );
    expect(() => psql(scratchRestore, "ALTER SYSTEM SET log_statement = 'none'")).toThrow(
      /permission denied/,
    );
  });
});
