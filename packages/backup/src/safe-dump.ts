/**
 * Scans a plain-SQL dump before psql reads it. psql runs any line it lexes as `\command`
 * (`\!` runs a shell command on the worker, `\copy`/`\i` read local files), so a backup
 * that came from elsewhere must not carry one. This follows psql's own lexer: strings,
 * quoted identifiers, $tag$ bodies, nested block comments, line comments and parenthesis
 * depth, so a backslash inside a literal is fine and a backslash anywhere else is refused.
 *
 * The dump is produced by our own pg_dump, so this is an allowlist, deliberately stricter
 * than psql wherever being exact would be fragile: no E'' / U&'' / N'' strings, no BEGIN
 * outside quotes (psql stops ending statements at `;` inside CREATE FUNCTION ... BEGIN),
 * one statement per line, only the exact SET lines pg_dump writes, no ALTER ROLE/DATABASE/
 * SYSTEM, and only the exact `COPY <identifiers> FROM stdin;` header (any other COPY is a
 * server-side file or program COPY).
 * Residual: SQL that builds commands at run time (a DO block running EXECUTE, a function body
 * calling COPY or lo_import) or changes the session encoding through obfuscated dynamic SQL
 * cannot be proven safe by a static scan; see docs/adr/0014. The database role the restore
 * runs as is the defence for that. ON_ERROR_STOP=1 (see psqlArgs) is load-bearing too.
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
  | { k: '"' }
  | { k: "$"; tag: string }
  | { k: "c"; depth: number }
  | { k: "s" }; // just after a closing quote at the end of a line

const IDENT = /[A-Za-z0-9_$\u0080-\uffff]/;
const WS = /\s/;
const isSpace = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return c === 32 || (c >= 9 && c <= 13) || (c > 127 && WS.test(ch));
};
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/y;
const PG_DUMP_META = /^\\(?:un)?restrict [A-Za-z0-9]+\r?$/;
/** The only COPY header allowed: identifiers (plain or "quoted"), commas, parentheses, spaces. */
const COPY_FROM_STDIN = /^COPY [A-Za-z0-9_."(), \u0080-\uffff]+ FROM stdin;\r?$/;
const COPY_START = /^\s*copy\b/i;
const SET_START = /^\s*(?:set|reset)\b/i;
const ALTER_SENSITIVE_START = /^\s*alter(?:\s*$|\s+(?:role|user|group|database|system)\b)/i;
const BEGIN_WORD = /\bbegin\b/i;
const SETTING_WORDS = /client_encoding|standard_conforming_strings|set_config/i;
/** Every SET pg_dump 14-17 writes in its preamble and per table, verbatim. */
const SET_LINES = new Set([
  "SET statement_timeout = 0;",
  "SET lock_timeout = 0;",
  "SET idle_in_transaction_session_timeout = 0;",
  "SET transaction_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "SET standard_conforming_strings = on;",
  "SET check_function_bodies = false;",
  "SET xmloption = content;",
  "SET client_min_messages = warning;",
  "SET row_security = off;",
  "SET default_tablespace = '';",
  "SET default_table_access_method = heap;",
  "SET default_with_oids = false;",
]);
/** The only lines allowed to mention a setting that changes how psql reads the file. */
const SETTING_LINES = new Set([
  ...SET_LINES,
  "SELECT pg_catalog.set_config('search_path', '', false);",
]);

export class DumpScanner {
  private lex: Lex = { k: "n" };
  private copy = false;
  private depth = 0;
  private pending = false;
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
    // Index just past the last non-space character: a quote closing there ends the line.
    let end = line.length;
    while (end > 0 && isSpace(line[end - 1]!)) end--;
    let normal = "";
    let ended = false; // a statement already ended with `;` on this line
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
          if (ch === "-" && nx === "-") {
            i = line.length;
            break;
          }
          if (ch === "/" && nx === "*") {
            this.lex = { k: "c", depth: 1 };
            i++;
            break;
          }
          if (isSpace(ch)) {
            normal += ch;
            break;
          }
          if (ended) this.fail("more than one statement on a line");
          if (ch === "'") {
            const p = line[i - 1];
            if (p !== undefined && IDENT.test(p)) {
              // Only a standalone B'' or X'' (bit and hex strings) may touch the quote.
              const bitOrHex = /[bBxX]/.test(p) && !(i > 1 && IDENT.test(line[i - 2]!));
              if (!bitOrHex) this.fail("string prefix (E, N, ...) or quote after an identifier");
            } else if (p === "&" && /[uU]/.test(line[i - 2] ?? "")) this.fail("U&'' string");
            this.lex = { k: "'" };
            this.pending = true;
          } else if (ch === '"') {
            if (line[i - 1] === "&" && /[uU]/.test(line[i - 2] ?? "")) this.fail('U&"" identifier');
            this.lex = { k: '"' };
            this.pending = true;
          } else if (ch === "$") {
            if (i > 0 && IDENT.test(line[i - 1]!)) this.fail("$ right after an identifier");
            DOLLAR_TAG.lastIndex = i;
            const tag = DOLLAR_TAG.exec(line);
            if (tag) {
              this.lex = { k: "$", tag: tag[0] };
              i += tag[0].length - 1;
            } else if (nx !== undefined && nx >= "0" && nx <= "9")
              normal += ch; // $1
            else this.fail("unexpected $");
            this.pending = true;
          } else {
            if (ch === "(") this.depth++;
            else if (ch === ")") this.depth = Math.max(0, this.depth - 1);
            normal += ch;
            if (ch === ";" && this.depth === 0) {
              this.pending = false;
              ended = true;
            } else this.pending = true;
          }
          break;
        }
        case "'":
          if (ch === "'") {
            if (nx === "'") i++;
            else this.lex = i + 1 >= end ? { k: "s" } : { k: "n" };
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
    // psql stops ending statements at `;` after CREATE FUNCTION ... BEGIN, whether or not
    // ATOMIC follows. pg_dump writes function bodies in $$ quotes, so a bare BEGIN is hostile.
    if (BEGIN_WORD.test(normal)) this.fail("BEGIN outside quotes");
    if (!pendingAtStart) {
      // Statement start (the previous one ended with `;` at paren depth 0).
      if (COPY_FROM_STDIN.test(line) && !this.pending && this.lex.k === "n") {
        this.copy = true;
        return;
      }
      if (COPY_START.test(normal)) this.fail("COPY other than FROM stdin");
      if (SET_START.test(normal) && !SET_LINES.has(line.trim()))
        this.fail("SET/RESET that pg_dump does not write");
      if (ALTER_SENSITIVE_START.test(normal)) this.fail("ALTER ROLE/DATABASE/SYSTEM");
    }
    if (/\bstdin\b/i.test(normal)) this.fail("COPY from stdin in an unexpected place");
  }

  finish(): void {
    if (this.copy) this.fail("the dump ends inside COPY data");
    if (this.lex.k !== "n" && this.lex.k !== "s")
      this.fail("the dump ends inside a quoted string or comment");
  }
}

/** Splits on "\n" only (psql does not treat a lone "\r" as a line end). Linear in the input. */
export async function scanDump(chunks: AsyncIterable<string> | Iterable<string>): Promise<void> {
  const scanner = new DumpScanner();
  let partial: string[] = []; // pieces of a line that continues in the next chunk
  for await (const chunk of chunks) {
    let from = 0;
    for (let at = chunk.indexOf("\n"); at !== -1; at = chunk.indexOf("\n", from)) {
      scanner.push(
        partial.length ? partial.join("") + chunk.slice(from, at) : chunk.slice(from, at),
      );
      partial = [];
      from = at + 1;
    }
    if (from < chunk.length) partial.push(from ? chunk.slice(from) : chunk);
  }
  const last = partial.join("");
  if (last) scanner.push(last);
  scanner.finish();
}

/** Bytes are read as latin1 so each byte is one character (UTF-8 never reuses ASCII bytes). */
export const assertSafeDumpFile = (file: string, opts: { chunkSize?: number } = {}) =>
  scanDump(
    createReadStream(file, { encoding: "latin1", highWaterMark: opts.chunkSize ?? 1024 * 1024 }),
  );

export const assertSafeDumpText = (sql: string) => scanDump([sql]);
