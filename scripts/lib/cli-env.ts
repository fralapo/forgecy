import { parseEnv } from "node:util";

/**
 * The only `.env` keys the CLI reads itself (health.ts, backup.ts). Nothing else is copied into
 * process.env: every child process (docker compose, pg_dump, psql, tar) inherits it, and a secret
 * like POSTGRES_PASSWORD or an API key has no business there. DATABASE_URL carries a password but
 * is what the CLI's own pg_dump/psql path (no Compose postgres running) connects with.
 */
const CLI_KEYS = new Set([
  "FORGECY_DATA_DIR",
  "MEDIA_ROOT",
  "DATABASE_URL",
  "POSTGRES_USER",
  "POSTGRES_DB",
  "FORGECY_PORT",
  "FORGECY_WORKER_HEALTH_PORT",
  "WORKER_HEALTH_PORT",
  "FORGECY_WEB_HEALTH_URL",
  "FORGECY_WORKER_HEALTH_URL",
]);

/**
 * Compose substitutes these in docker-compose.yml, and a shell variable beats its own .env parse.
 * Node keeps `$$` raw where Compose turns it into `$`, so a value with `$` is left to Compose.
 */
const COMPOSE_INTERPOLATED = new Set([
  "POSTGRES_USER",
  "POSTGRES_DB",
  "FORGECY_PORT",
  "FORGECY_WORKER_HEALTH_PORT",
]);

/** What to add to the environment from the text of a `.env`: allowlisted keys the shell has not set. */
export function parseCliEnv(
  text: string,
  base: Record<string, string | undefined>,
): Record<string, string> {
  const parsed = parseEnv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || !CLI_KEYS.has(key) || base[key] !== undefined) continue;
    if (COMPOSE_INTERPOLATED.has(key) && value.includes("$")) continue;
    out[key] = value;
  }
  return out;
}
