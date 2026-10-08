/**
 * Forgecy CLI: one entry point for the self-hosted install.
 *   pnpm forgecy <init|start|stop|migrate|seed|backup|restore|upgrade|health> [options]
 */
import "./lib/load-env";
import { existsSync, readFileSync } from "node:fs";
import { backup, restore } from "./lib/backup";
import { parseDotenv } from "./lib/dotenv";
import { checkHealth, healthTargets } from "./lib/health";
import { initEnv, MAIN_DB_MARKER } from "./lib/init";
import { checkSecrets } from "./lib/secrets";
import { compose, readOnlyComposeEnv, run } from "./lib/shell";

const [command, ...args] = process.argv.slice(2);

async function health(): Promise<void> {
  const results = await checkHealth(healthTargets(process.env));
  for (const result of results) console.log(result.line);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

/**
 * Stops before anything is built or started with a missing or guessable secret. Reads .env itself:
 * parseCliEnv deliberately keeps secrets out of process.env, so they never reach child processes.
 * A POSTGRES_PASSWORD set in the shell wins over .env, as it does in Compose.
 */
function preflight(): void {
  if (!existsSync(".env")) throw new Error("No .env file. Run `pnpm forgecy init` to create one.");
  const file = parseDotenv(readFileSync(".env", "utf8"));
  const env = {
    ...file,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? file.POSTGRES_PASSWORD,
  };
  const { errors, warnings } = checkSecrets(env, { existingDatabase: existsSync(MAIN_DB_MARKER) });
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (errors.length) throw new Error(`Fix .env before starting:\n- ${errors.join("\n- ")}`);
}

/** Creates .env with generated secrets, or with --fill fills the ones that are empty. See initEnv. */
function init(): void {
  const { created, filled, passwordSkipped } = initEnv(process.cwd(), {
    fill: args.includes("--fill"),
  });
  if (filled.length)
    console.log(`${created ? "Created .env with" : "Filled"}: ${filled.join(", ")}.`);
  else if (!passwordSkipped) console.log("Nothing to fill: every secret already has a value.");
  if (passwordSkipped)
    console.log(
      "POSTGRES_PASSWORD was left empty: a database already exists in data/db or data/dev-db. Set it to that database's current password (`forgecy` on installs from before this check), see README, Upgrading.",
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
  stop: () => compose(["down"], readOnlyComposeEnv(process.env)),
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
