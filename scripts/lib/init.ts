import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { emptyKeys, fillEnv, generateSecrets } from "./secrets";
import type { GeneratedSecrets, SecretKey } from "./secrets";

/** Present once Postgres has initialised the main stack's data directory (see preflight). */
export const MAIN_DB_MARKER = "data/db/PG_VERSION";
/** A database exists for the main stack or for docker-compose.dev.yml: its password cannot be changed from .env. */
const DB_MARKERS = [MAIN_DB_MARKER, "data/dev-db/PG_VERSION"];

/**
 * Replaces `path` with `content` without ever leaving it half written: the new text goes to a
 * private temp file next to it (mode 0600, best effort on Windows), then is renamed over it. If
 * the rename is refused (Windows can, for a file in use) it falls back to copy; the temp file is
 * removed either way.
 */
export function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { flag: "wx", mode: 0o600 });
  try {
    try {
      renameSync(tmp, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")
        throw error;
    }
    copyFileSync(tmp, path);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

export interface InitResult {
  created: boolean;
  filled: SecretKey[];
  /** POSTGRES_PASSWORD is empty but was not generated because a database already exists. */
  passwordSkipped: boolean;
}

/**
 * Creates `.env` in `dir` from `.env.example` with generated secrets, or with `fill` fills the
 * secrets that are empty in the existing one. A value that is set is never changed, and a database
 * password is never generated for a database that already exists. Never prints a secret.
 */
export function initEnv(dir: string, options: { fill: boolean }): InitResult {
  const file = join(dir, ".env");
  const created = !existsSync(file);
  if (!created && !options.fill)
    throw new Error(
      ".env already exists: not touching it. To generate only the secrets that are empty in it, run `pnpm forgecy init --fill`.",
    );
  const text = readFileSync(created ? join(dir, ".env.example") : file, "utf8");
  const databaseExists = DB_MARKERS.some((marker) => existsSync(join(dir, marker)));
  const generated = generateSecrets();
  const secrets: Partial<GeneratedSecrets> = {};
  const filled = emptyKeys(text).filter((key) => !(databaseExists && key === "POSTGRES_PASSWORD"));
  for (const key of filled) secrets[key] = generated[key];
  const out = fillEnv(text, secrets);
  // "wx": never replaces a file that appeared meanwhile.
  if (created) writeFileSync(file, out, { flag: "wx", mode: 0o600 });
  else if (out !== text) writeFileAtomic(file, out);
  return {
    created,
    filled,
    passwordSkipped: databaseExists && emptyKeys(out).includes("POSTGRES_PASSWORD"),
  };
}
