import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root (fileURLToPath: `URL.pathname` breaks on Windows). */
export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Text of a repo file with LF line endings (the Windows checkout is CRLF). */
export const read = (rel: string): string =>
  readFileSync(join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");
