import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  restoreDatabaseUrl,
  restoreOwnershipSql,
  restoreRoleName,
  stripExtensionStatements,
  withoutExtensionEntries,
  withoutExtensionStatements,
} from "../src/restore-role";

// Pure (no database, no psql): runs on every host.
describe("restoreDatabaseUrl", () => {
  it("is unset (restore as DATABASE_URL) when empty or blank", () => {
    expect(restoreDatabaseUrl(undefined)).toBeUndefined();
    expect(restoreDatabaseUrl("")).toBeUndefined();
    expect(restoreDatabaseUrl("  ")).toBeUndefined();
  });

  it.each([
    "postgres://forgecy_restore:s3cret@localhost:5432/forgecy",
    "postgresql://forgecy_restore:s3cret@postgres:5432/forgecy?sslmode=require",
  ])("accepts %s", (url) => {
    expect(restoreDatabaseUrl(` ${url} `)).toBe(url);
    expect(restoreRoleName(url)).toBe("forgecy_restore");
  });

  it.each([
    ["not a url s3cret", /not a valid URL/],
    ["mysql://forgecy_restore:s3cret@h/db", /must start with postgres:\/\//],
    ["postgres://h:5432/db", /must name its role/],
    ["postgres://bad%24role:s3cret@h/db", /must name its role/],
    ["postgres://x'y:s3cret@h/db", /must name its role/],
  ])("refuses %s without repeating it", (value, message) => {
    let error: unknown;
    try {
      restoreDatabaseUrl(value);
    } catch (err) {
      error = err;
    }
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain("s3cret");
  });
});

describe("restoreOwnershipSql", () => {
  it("embeds a validated role and refuses anything else", () => {
    expect(restoreOwnershipSql("forgecy_restore")).toContain("r text := 'forgecy_restore';");
    expect(() => restoreOwnershipSql("x'; DROP TABLE users; --")).toThrow(/Invalid/);
    expect(() => restoreOwnershipSql("a$forgecy$b")).toThrow(/Invalid/);
  });
});

const head = [
  "SET client_encoding = 'UTF8';",
  "DROP EXTENSION IF EXISTS vector;",
  "DROP SCHEMA IF EXISTS drizzle;",
  "CREATE SCHEMA drizzle;",
  "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;",
  "COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';",
  "CREATE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $$\r",
  "BEGIN RETURN NEW; END;\r",
  "$$;",
  "COPY public.notes (body) FROM stdin;",
  // Table data that happens to read like an extension statement is data: kept.
  "DROP EXTENSION IF EXISTS vector;",
  "\\.",
  "",
].join("\n");

describe("withoutExtensionStatements", () => {
  it("drops the extension lines before the data and keeps everything else byte for byte", () => {
    expect(withoutExtensionStatements(head)).toBe(
      [
        "SET client_encoding = 'UTF8';",
        "DROP SCHEMA IF EXISTS drizzle;",
        "CREATE SCHEMA drizzle;",
        "CREATE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $$\r",
        "BEGIN RETURN NEW; END;\r",
        "$$;",
        "COPY public.notes (body) FROM stdin;",
        "DROP EXTENSION IF EXISTS vector;",
        "\\.",
        "",
      ].join("\n"),
    );
  });

  it("does the same on a file, across stream chunks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forgecy-restore-role-"));
    try {
      // Large enough to span several 64 KiB read chunks, with the data after them.
      const big = `${"-- filler line\n".repeat(20_000)}${head}${"x\ty\n".repeat(30_000)}`;
      const file = join(dir, "db.sql");
      writeFileSync(file, big);
      await stripExtensionStatements(file);
      expect(readFileSync(file, "utf8")).toBe(withoutExtensionStatements(big));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("withoutExtensionEntries", () => {
  // As `pg_restore -l` (17) prints a dump of the migrated schema.
  const list = [
    ";",
    "; Archive created at 2026-10-09 12:24:30",
    ";     Format: CUSTOM",
    ";",
    "7; 2615 16385 SCHEMA - drizzle postgres",
    "2; 3079 16395 EXTENSION - vector ",
    "4926; 0 0 COMMENT - EXTENSION vector ",
    "1103; 1247 17060 TYPE public actor_type postgres",
    "412; 1255 17302 FUNCTION public brand_versions_guard() postgres",
    "4927; 0 0 COMMENT public TABLE extension_notes postgres",
    "5000; 0 17400 TABLE DATA public app_settings postgres",
    "",
  ].join("\n");

  it("leaves out the extension and its comment, and nothing else", () => {
    const out = withoutExtensionEntries(list).split("\n");
    expect(out).not.toContain("2; 3079 16395 EXTENSION - vector ");
    expect(out).not.toContain("4926; 0 0 COMMENT - EXTENSION vector ");
    expect(out).toHaveLength(list.split("\n").length - 2);
    expect(out).toContain("4927; 0 0 COMMENT public TABLE extension_notes postgres");
    expect(withoutExtensionEntries(list.replaceAll("\n", "\r\n"))).not.toMatch(/EXTENSION - /);
  });
});
