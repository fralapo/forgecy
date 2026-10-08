import { randomBytes } from "node:crypto";
import { parseDotenv } from "./dotenv";

const GUESSABLE = new Set(["forgecy", "change-me", "changeme", "password", "postgres", "secret"]);

/** The secrets `pnpm forgecy init` generates. A type alias (not an interface) so it fits a string map. */
export type GeneratedSecrets = {
  POSTGRES_PASSWORD: string;
  BETTER_AUTH_SECRET: string;
  FORGECY_ENCRYPTION_KEY: string;
};

export type SecretKey = keyof GeneratedSecrets;
const SECRET_KEYS: SecretKey[] = [
  "POSTGRES_PASSWORD",
  "BETTER_AUTH_SECRET",
  "FORGECY_ENCRYPTION_KEY",
];

/**
 * What breaks the password where it is used: URL userinfo in DATABASE_URL (/ @ : % ? # [ ]), the
 * .env parsers and Compose interpolation ($ # quotes backslash), and anything not printable ASCII.
 * `+` and `=` are fine (the tail of `openssl rand -base64 32`).
 */
const BREAKS_PASSWORD = /[^\x21-\x7e]|[/@:%?#[\]$'"\\`]/;

/** Problems that must stop `start`/`migrate`/`upgrade`, and ones worth a warning. Never echoes a value. */
export function checkSecrets(
  env: Record<string, string | undefined>,
  options: { existingDatabase: boolean },
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const password = env.POSTGRES_PASSWORD ?? "";
  if (!password) {
    errors.push(
      options.existingDatabase
        ? "POSTGRES_PASSWORD is empty, but a database already exists in data/db. Installs from before this check had no password in .env and used the default `forgecy`: add POSTGRES_PASSWORD=forgecy to .env to keep the current database, then rotate it (README, Upgrading)."
        : "POSTGRES_PASSWORD is empty. Run `pnpm forgecy init --fill` to generate it, or set it in .env.",
    );
  } else if (BREAKS_PASSWORD.test(password)) {
    errors.push(
      "POSTGRES_PASSWORD must not contain spaces or any of / @ : % ? # [ ] $ ' \" \\ ` (for example `openssl rand -hex 24` makes a safe one).",
    );
  } else if (GUESSABLE.has(password.toLowerCase())) {
    if (options.existingDatabase)
      warnings.push(
        "POSTGRES_PASSWORD is guessable. The password inside the existing database does not change when you edit .env: change it with ALTER USER first, then update .env (README, Upgrading).",
      );
    else
      errors.push(
        "POSTGRES_PASSWORD is guessable. Replace it in .env by hand (for example with `openssl rand -hex 24`) and use the same value in DATABASE_URL. If a database already exists in data/db, add POSTGRES_PASSWORD=forgecy to keep it, then rotate it (README, Upgrading).",
      );
  }
  const authSecret = env.BETTER_AUTH_SECRET ?? "";
  if (authSecret.length < 32)
    errors.push(
      authSecret
        ? "BETTER_AUTH_SECRET must be at least 32 characters: replace it in .env by hand (openssl rand -base64 32)."
        : "BETTER_AUTH_SECRET is empty. Run `pnpm forgecy init --fill` to generate it, or set 32+ characters in .env (openssl rand -base64 32).",
    );
  return { errors, warnings };
}

export function generateSecrets(): GeneratedSecrets {
  return {
    POSTGRES_PASSWORD: randomBytes(24).toString("base64url"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    FORGECY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
}

/** The generated secrets whose value is missing or empty in a .env text. */
export function emptyKeys(text: string): SecretKey[] {
  const env = parseDotenv(text);
  return SECRET_KEYS.filter((key) => !env[key]);
}

/** The secrets whose parsed value is set in `after` and was different in `before`: what really got filled. */
export function confirmedKeys(before: string, after: string): SecretKey[] {
  const was = parseDotenv(before);
  const now = parseDotenv(after);
  return SECRET_KEYS.filter((key) => now[key] && now[key] !== was[key]);
}

/** Replaces the text of the last match of `line` (the one that wins) with `edit(match)`. */
function editLast(
  text: string,
  line: RegExp,
  edit: (match: RegExpMatchArray) => string | undefined,
): string | undefined {
  const last = [...text.matchAll(line)].at(-1);
  const replacement = last && edit(last);
  return last && replacement !== undefined
    ? `${text.slice(0, last.index)}${replacement}${text.slice(last.index + last[0].length)}`
    : undefined;
}

/**
 * Fills the given secrets where the .env text has them missing or empty; a value that is set is
 * never touched. Emptiness is decided by parseDotenv (what Compose sees). The line that is edited
 * is the last `[export ]KEY=` one (the one that wins), keeping its prefix, indentation and trailing
 * comment; a key that is absent is appended. A DATABASE_URL (last one, quoted or not) whose
 * password is a placeholder gets the new password. Other lines, their order and the line endings
 * stay as they are.
 *
 * Then it checks its own work: parsing the result, every key it filled must hold the new value and
 * every other key must be unchanged (DATABASE_URL excepted when the password was filled). If not
 * (a key that only exists inside a multi-line quoted value, an exotic quoting) it throws rather
 * than return text that would overwrite something.
 */
export function fillEnv(text: string, secrets: Partial<GeneratedSecrets>): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const empty = new Set(emptyKeys(text));
  const filled: SecretKey[] = [];
  let out = text;
  for (const key of SECRET_KEYS) {
    const value = secrets[key];
    if (!value || !empty.has(key)) continue;
    filled.push(key);
    // `[ \t]` rather than `\s`, which would run across lines; `.` stops before \r.
    const line = new RegExp(`^([ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=)(.*)$`, "gm");
    out =
      editLast(out, line, (m) => {
        const comment = /#.*$/.exec(m[2] ?? "")?.[0];
        return `${m[1]}${value}${comment ? ` ${comment}` : ""}`;
      }) ?? `${out}${out === "" || out.endsWith("\n") ? "" : eol}${key}=${value}${eol}`;
    if (key === "POSTGRES_PASSWORD")
      out =
        editLast(
          out,
          /^([ \t]*(?:export[ \t]+)?DATABASE_URL[ \t]*=[ \t]*["']?postgres(?:ql)?:\/\/[^:@/\s]*:)([^@\s"']*)(@.*)$/gm,
          (m) =>
            !m[2] || m[2] === "CHANGE_ME" || GUESSABLE.has(m[2].toLowerCase())
              ? `${m[1]}${value}${m[3]}`
              : undefined,
        ) ?? out;
  }
  const before = parseDotenv(text);
  const after = parseDotenv(out);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const expected = filled.includes(key as SecretKey) ? secrets[key as SecretKey] : before[key];
    const ok =
      key === "DATABASE_URL" && filled.includes("POSTGRES_PASSWORD")
        ? after[key] === before[key] || after[key]?.includes(secrets.POSTGRES_PASSWORD ?? "")
        : after[key] === expected;
    if (!ok) throw new Error(`Cannot edit .env safely: the result would read ${key} differently.`);
  }
  return out;
}
