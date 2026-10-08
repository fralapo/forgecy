/**
 * Forgecy CLI: one entry point for the self-hosted install.
 *   pnpm forgecy <start|stop|migrate|seed|backup|restore|upgrade|health> [options]
 */
import "./lib/load-env";
import { backup, restore } from "./lib/backup";
import { checkHealth, healthTargets } from "./lib/health";
import { compose, run } from "./lib/shell";

const [command, ...args] = process.argv.slice(2);

async function health(): Promise<void> {
  const results = await checkHealth(healthTargets(process.env));
  for (const result of results) console.log(result.line);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

const commands: Record<string, () => unknown> = {
  start: () => compose(["up", "-d", "--build"]),
  stop: () => compose(["down"]),
  migrate: () => compose(["run", "--rm", "migrate"]),
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
