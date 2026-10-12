import { parseEnv } from "node:util";

/**
 * Reads .env text the way Compose does, on top of Node's `util.parseEnv`, the CLI's only parser.
 *
 * Node differs from Compose, godotenv and dotenv in ways that matter for secrets:
 * - `KEY= ` (only spaces or tabs after the `=`) swallows the next line: `KEY= \nNEXT=x` gives
 *   `KEY="NEXT=x"`. Compose trims an unquoted value, so KEY is empty and NEXT is set. Compose
 *   accepts almost any key name here (`A.B`, `A-B`, `1A`), so the pattern is not limited to
 *   identifiers.
 * - `export KEY=` with an empty value is stored under the name `export KEY`.
 * - `KEY: value` (YAML style) is a setting for Compose and is ignored by Node.
 * - A lone CR ends a line for Compose; Node glues the lines together.
 * Believing Node would hide an empty password from the checks and let a "fill" overwrite the key
 * that follows. So line endings are unified, the `export` prefix is dropped, `KEY: value` becomes
 * `KEY=value`, and a value that is only whitespace is emptied before parsing.
 *
 * Not covered here, because it needs the raw line: Node cuts an unquoted value at any `#`, Compose
 * only at ` #` (see hashInValue in secrets.ts).
 *
 * Every read of a .env in the CLI goes through here.
 */
export function parseDotenv(text: string): Record<string, string | undefined> {
  return parseEnv(
    text
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .replace(/^([ \t]*)export[ \t]+(?=[A-Za-z_])/gm, "$1")
      .replace(/^([ \t]*[A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:[ \t]*(?=\S)/gm, "$1=")
      .replace(/^([ \t]*[^\s=#'"]+[ \t]*=)[ \t]+(?=$)/gm, "$1"),
  );
}
