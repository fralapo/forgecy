import { parseEnv } from "node:util";

/**
 * Reads .env text the way Compose does, on top of Node's `util.parseEnv`, the CLI's only parser.
 *
 * Node differs from Compose, godotenv and dotenv in two ways that matter for secrets:
 * - `KEY= ` (only spaces or tabs after the `=`) swallows the next line: `KEY= \nNEXT=x` gives
 *   `KEY="NEXT=x"`. Compose trims an unquoted value, so KEY is empty and NEXT is set.
 * - `export KEY=` with an empty value is stored under the name `export KEY`.
 * Believing Node would hide an empty password from the checks and let a "fill" overwrite the key
 * that follows. So the `export` prefix (any spaces or tabs after it) is dropped and a value that is
 * only whitespace is emptied before parsing.
 *
 * Every read of a .env in the CLI goes through here.
 */
export function parseDotenv(text: string): Record<string, string | undefined> {
  return parseEnv(
    text
      .replace(/^\uFEFF/, "")
      .replace(/^([ \t]*)export[ \t]+(?=[A-Za-z_])/gm, "$1")
      .replace(/^([ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*=)[ \t]+(?=\r?$)/gm, "$1"),
  );
}
