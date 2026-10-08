/**
 * Forgecy CLI: one entry point for the self-hosted install.
 *   pnpm forgecy <init|start|stop|migrate|seed|backup|restore|upgrade|health> [options]
 */
import "./lib/load-env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { backup, restore } from "./lib/backup";
import { checkHealth, healthTargets } from "./lib/health";
import { checkSecrets, emptyKeys, fillEnv, generateSecrets } from "./lib/secrets";
import type { GeneratedSecrets } from "./lib/secrets";
import { compose, run } from "./lib/shell";

const [command, ...args] = process.argv.slice(2);

async function health(): Promise<void> {
  const results = await checkHealth(healthTargets(process.env));
  for (const result of results) console.log(result.line);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

// Present once Postgres has initialised ./data/db: its password can no longer be changed from .env.
const DATABASE_MARKER = "data/db/PG_VERSION";

/**
 * Stops before anything is built or started with a missing or guessable secret. Reads .env itself:
 * parseCliEnv deliberately keeps secrets out of process.env, so they never reach child processes.
 * A POSTGRES_PASSWORD set in the shell wins over .env, as it does in Compose.
 */
function preflight(): void {
  if (!existsSync(".env")) throw new Error("No .env file. Run `pnpm forgecy init` to create one.");
  const file = parseEnv(readFileSync(".env", "utf8").replace(/^\uFEFF/, ""));
  const env = {
    ...file,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? file.POSTGRES_PASSWORD,
  };
  const { errors, warnings } = checkSecrets(env, { existingDatabase: existsSync(DATABASE_MARKER) });
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (errors.length) throw new Error(`Fix .env before starting:\n- ${errors.join("\n- ")}`);
}

/**
 * Creates .env from .env.example with generated secrets, or with --fill fills the secrets that are
 * empty in an existing .env. A value that is already set is never changed, and a database password
 * is never generated for a database that already exists. Secret values are never printed.
 */
function init(): void {
  const exists = existsSync(".env");
  if (exists && !args.includes("--fill"))
    throw new Error(
      ".env already exists: not touching it. To generate only the secrets that are empty in it, run `pnpm forgecy init --fill`.",
    );
  const text = readFileSync(exists ? ".env" : ".env.example", "utf8");
  const keepPassword = existsSync(DATABASE_MARKER);
  const generated = generateSecrets();
  const secrets: Partial<GeneratedSecrets> = {};
  const filled = emptyKeys(text).filter((key) => !(keepPassword && key === "POSTGRES_PASSWORD"));
  for (const key of filled) secrets[key] = generated[key];
  const out = fillEnv(text, secrets);
  // Best effort on Windows, where the mode is ignored. "wx" never replaces a file created meanwhile.
  if (!exists) writeFileSync(".env", out, { flag: "wx", mode: 0o600 });
  else if (out !== text) writeFileSync(".env", out);
  const skipped = keepPassword && emptyKeys(out).includes("POSTGRES_PASSWORD");
  if (filled.length)
    console.log(`${exists ? "Filled" : "Created .env with"}: ${filled.join(", ")}.`);
  else if (!skipped) console.log("Nothing to fill: every secret already has a value.");
  if (skipped)
    console.log(
      "POSTGRES_PASSWORD was left empty: a database already exists in data/db. Set it to that database's current password (`forgecy` on installs from before this check), see README, Upgrading.",
    );
  if (filled.includes("FORGECY_ENCRYPTION_KEY"))
    console.log(
      "Keep a copy of FORGECY_ENCRYPTION_KEY outside the backups: without it the saved AI keys cannot be read.",
    );
}

const commands: Record<string, () => unknown> = {
  init,
  start: () => {
    preflight();
    return compose(["up", "-d", "--build"]);
  },
  stop: () => compose(["down"]),
  migrate: () => {
    preflight();
    return compose(["run", "--rm", "migrate"]);
  },
  seed: () => run("pnpm", ["--filter", "@forgecy/db", "seed"]),
  backup: async () => {
    const file = await backup();
    console.log(`Backup written to ${file}`);
  },
  restore: async () => {
    const file = args.find((a) => !a.startsWith("--"));
    if (!file) throw new Error("Usage: pnpm forgecy restore <archive.tar.gz> --yes");
    if (!args.includes("--yes"))
      throw new Error("Restore replaces the database and files. Re-run with --yes to confirm.");
    await restore(file);
    console.log("Restore completed");
  },
  // Backup first, then rebuild, migrate and restart (spec: "Upgrades").
  upgrade: async () => {
    preflight();
    const file = await backup();
    console.log(`Pre-upgrade backup: ${file}`);
    compose(["build"]);
    compose(["run", "--rm", "migrate"]);
    compose(["up", "-d"]);
  },
  health,
};

const handler = command ? commands[command] : undefined;
if (!handler) {
  console.log(`Usage: pnpm forgecy <${Object.keys(commands).join("|")}>`);
  process.exit(command ? 1 : 0);
}
await handler();
