import { randomBytes } from "node:crypto";

const GUESSABLE = new Set(["forgecy", "change-me", "changeme", "password", "postgres", "secret"]);

/** The secrets `pnpm forgecy init` generates. A type alias (not an interface) so it fits a string map. */
export type GeneratedSecrets = {
  POSTGRES_PASSWORD: string;
  BETTER_AUTH_SECRET: string;
  FORGECY_ENCRYPTION_KEY: string;
};

type SecretKey = keyof GeneratedSecrets;
const SECRET_KEYS: SecretKey[] = [
  "POSTGRES_PASSWORD",
  "BETTER_AUTH_SECRET",
  "FORGECY_ENCRYPTION_KEY",
];

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
        : "POSTGRES_PASSWORD is empty. Run `pnpm forgecy init`, or set it in .env.",
    );
  } else if (/[^A-Za-z0-9._~-]/.test(password)) {
    // The password is placed inside DATABASE_URL (and read by Compose and dotenv), where these characters break.
    errors.push("POSTGRES_PASSWORD may only contain letters, digits and . _ ~ -");
  } else if (GUESSABLE.has(password.toLowerCase())) {
    if (options.existingDatabase)
      warnings.push(
        "POSTGRES_PASSWORD is guessable. The password inside the existing database does not change when you edit .env: change it with ALTER USER first (README, Upgrading).",
      );
    else
      errors.push(
        "POSTGRES_PASSWORD is guessable. Run `pnpm forgecy init`, or choose a long random one.",
      );
  }
  if ((env.BETTER_AUTH_SECRET ?? "").length < 32)
    errors.push("BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32).");
  return { errors, warnings };
}

export function generateSecrets(): GeneratedSecrets {
  return {
    POSTGRES_PASSWORD: randomBytes(24).toString("base64url"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    FORGECY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
}

/** Value of `KEY=value` in a .env text, trimmed and unquoted; undefined when the line is missing. */
function valueOf(text: string, key: string): string | undefined {
  const raw = new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1]?.trim();
  return raw?.replace(/^(["'])(.*)\1$/, "$2");
}

/** The generated secrets whose value is missing or empty in a .env text. */
export function emptyKeys(text: string): SecretKey[] {
  return SECRET_KEYS.filter((key) => !valueOf(text, key));
}

/**
 * Fills the given secrets where the .env text has them missing or empty; a value that is already
 * set is never touched. A DATABASE_URL whose password is a placeholder gets the new password.
 * Every other line and the line endings stay as they are (`.` does not match \r).
 */
export function fillEnv(text: string, secrets: Partial<GeneratedSecrets>): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let out = text;
  for (const key of SECRET_KEYS) {
    const value = secrets[key];
    if (!value || valueOf(out, key)) continue;
    const line = new RegExp(`^${key}=.*$`, "m");
    out = line.test(out)
      ? out.replace(line, () => `${key}=${value}`)
      : `${out}${out === "" || out.endsWith("\n") ? "" : eol}${key}=${value}${eol}`;
    if (key === "POSTGRES_PASSWORD")
      out = out.replace(
        /^(DATABASE_URL=postgres:\/\/[^:@/\s]*:)([^@\s]*)(@.*)$/m,
        (whole, head: string, password: string, tail: string) =>
          !password || password === "CHANGE_ME" || GUESSABLE.has(password.toLowerCase())
            ? `${head}${value}${tail}`
            : whole,
      );
  }
  return out;
}
