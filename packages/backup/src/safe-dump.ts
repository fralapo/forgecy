/**
 * Scans a plain-SQL dump before psql reads it. psql runs any line it lexes as `\command`
 * (`\!` runs a shell command on the worker, `\copy`/`\i` read local files), so a backup
 * that came from elsewhere must not carry one. This follows psql's own lexer: strings,
 * E'' strings, quoted identifiers, $tag$ bodies, nested block comments, line comments and
 * parenthesis depth, so a backslash inside a literal is fine and a backslash anywhere else
 * is refused. It is deliberately stricter than psql where being exact would be fragile
 * (COPY forms, BEGIN ATOMIC, string continuation, settings that change lexing).
 * Server-side `COPY ... PROGRAM` and `COPY ... TO/FROM 'file'` are refused too: the only COPY
 * pg_dump writes is `COPY ... FROM stdin;` at a statement start.
 * Residual: SQL that builds a command at run time (a DO block running EXECUTE, a function
 * body calling COPY or lo_import) or that changes the session encoding through obfuscated
 * dynamic SQL cannot be proven safe by a static scan; see docs/adr/0014. Running the load as
 * a non-superuser database role is the defence for that.
 */
import { createReadStream } from "node:fs";

export class UnsafeDumpError extends Error {
  constructor(
    readonly line: number,
    readonly reason: string,
  ) {
    super(`Unsafe database dump, line ${line}: ${reason}`);
    this.name = "UnsafeDumpError";
  }
}

type Lex =
  | { k: "n" }
  | { k: "'" }
  | { k: "e" }
  | { k: '"' }
  | { k: "$"; tag: string }
  | { k: "c"; depth: number }
  | { k: "s" }; // just after a closing quote at the end of a line

const IDENT = /[A-Za-z0-9_$\u0080-\uffff]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;
const PG_DUMP_META = /^\\(?:un)?restrict [A-Za-z0-9]+\r?$/;
const COPY_FROM_STDIN = /^COPY [^;]+ FROM stdin;$/;
const COPY_AT_START = /^\s*copy\b/i;
const COPY_AFTER_SEMICOLON = /;\s*copy\b/i;
const SETTING_WORDS = /client_encoding|standard_conforming_strings|set_config/i;
/** The only lines allowed to mention a setting that changes how psql reads the file. */
const SETTING_LINES = new Set([
  "SET client_encoding = 'UTF8';",
  "SET standard_conforming_strings = on;",
  "SELECT pg_catalog.set_config('search_path', '', false);",
]);

export class DumpScanner {
  private lex: Lex = { k: "n" };
  private copy = false;
  private depth = 0;
  private pending = false;
  private tail = "";
  private n = 0;

  private fail(reason: string): never {
    throw new UnsafeDumpError(this.n, reason);
  }

  push(line: string): void {
    this.n++;
    if (line.includes("\0")) this.fail("NUL byte");
    if (this.copy) {
      if (line === "\\." || line === "\\.\r") this.copy = false;
      else if (line.startsWith("\\.")) this.fail("data line that looks like the end of COPY");
      return;
    }
    if (SETTING_WORDS.test(line) && !SETTING_LINES.has(line.trim()))
      this.fail("changes how the file is read");
    if (this.lex.k === "s") {
      const t = line.trim();
      if (t === "" || t.startsWith("--")) return;
      if (t.startsWith("'")) this.fail("string continued on the next line");
      this.lex = { k: "n" };
    }
    const pendingAtStart = this.pending;
    const normalAtStart = this.lex.k === "n";
    let normal = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      const nx = line[i + 1];
      const lex = this.lex;
      switch (lex.k) {
        case "n": {
          if (ch === "\\") {
            if (i === 0 && !pendingAtStart && PG_DUMP_META.test(line)) return;
            this.fail("psql meta-command");
          }
          const dollar =
            ch === "$" && !(i > 0 && IDENT.test(line[i - 1]!))
              ? DOLLAR_TAG.exec(line.slice(i))
              : null;
          if (ch === "-" && nx === "-") i = line.length;
          else if (ch === "/" && nx === "*") {
            this.lex = { k: "c", depth: 1 };
            i++;
          } else if (ch === "'") {
            const p = line[i - 1];
            const isE = (p === "e" || p === "E") && !(i > 1 && IDENT.test(line[i - 2]!));
            this.lex = { k: isE ? "e" : "'" };
            this.pending = true;
          } else if (ch === '"') {
            this.lex = { k: '"' };
            this.pending = true;
          } else if (dollar) {
            this.lex = { k: "$", tag: dollar[0] };
            this.pending = true;
            i += dollar[0].length - 1;
          } else {
            if (ch === "(") this.depth++;
            else if (ch === ")") this.depth = Math.max(0, this.depth - 1);
            normal += ch;
            if (ch === ";" && this.depth === 0) this.pending = false;
            else if (!/\s/.test(ch)) this.pending = true;
          }
          break;
        }
        case "'":
        case "e":
          if (lex.k === "e" && ch === "\\") i++;
          else if (ch === "'") {
            if (nx === "'") i++;
            else this.lex = line.slice(i + 1).trim() === "" ? { k: "s" } : { k: "n" };
          }
          break;
        case '"':
          if (ch === '"') {
            if (nx === '"') i++;
            else this.lex = { k: "n" };
          }
          break;
        case "$":
          if (ch === "$" && line.startsWith(lex.tag, i)) {
            i += lex.tag.length - 1;
            this.lex = { k: "n" };
          }
          break;
        case "c":
          if (ch === "/" && nx === "*") {
            lex.depth++;
            i++;
          } else if (ch === "*" && nx === "/") {
            i++;
            if (--lex.depth === 0) this.lex = { k: "n" };
          }
          break;
        case "s":
          break;
      }
    }
    this.tail = `${this.tail} ${normal}`.slice(-64);
    if (/\bbegin\s+atomic\b/i.test(this.tail)) this.fail("BEGIN ATOMIC bodies are not accepted");
    const atStatementStart = normalAtStart && !pendingAtStart && this.depth === 0;
    if (atStatementStart && this.lex.k === "n" && COPY_FROM_STDIN.test(normal.trim())) {
      this.copy = true;
      return;
    }
    // Any other COPY statement is server-side (PROGRAM or a file path): pg_dump never writes one.
    if ((atStatementStart && COPY_AT_START.test(normal)) || COPY_AFTER_SEMICOLON.test(normal))
      this.fail("COPY other than FROM stdin");
    if (/\bstdin\b/i.test(normal)) this.fail("COPY from stdin in an unexpected place");
  }

  finish(): void {
    if (this.copy) this.fail("the dump ends inside COPY data");
    if (this.lex.k !== "n" && this.lex.k !== "s")
      this.fail("the dump ends inside a quoted string or comment");
  }
}

/** Splits on "\n" only (psql does not treat a lone "\r" as a line end). */
export async function scanDump(chunks: AsyncIterable<string> | Iterable<string>): Promise<void> {
  const scanner = new DumpScanner();
  let rest = "";
  for await (const chunk of chunks) {
    rest += chunk;
    let from = 0;
    for (let at = rest.indexOf("\n"); at !== -1; at = rest.indexOf("\n", from)) {
      scanner.push(rest.slice(from, at));
      from = at + 1;
    }
    rest = rest.slice(from);
  }
  if (rest) scanner.push(rest);
  scanner.finish();
}

/** Bytes are read as latin1 so each byte is one character (UTF-8 never reuses ASCII bytes). */
export const assertSafeDumpFile = (file: string, opts: { chunkSize?: number } = {}) =>
  scanDump(
    createReadStream(file, { encoding: "latin1", highWaterMark: opts.chunkSize ?? 1024 * 1024 }),
  );

export const assertSafeDumpText = (sql: string) => scanDump([sql]);
