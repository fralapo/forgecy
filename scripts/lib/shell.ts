import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseDotenv } from "./dotenv";

export function run(
  cmd: string,
  args: string[],
  options: { input?: string; capture?: boolean; env?: NodeJS.ProcessEnv } = {},
): string {
  const result = spawnSync(cmd, args, {
    stdio: options.capture
      ? ["pipe", "pipe", "inherit"]
      : options.input
        ? ["pipe", "inherit", "inherit"]
        : "inherit",
    input: options.input,
    ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${cmd} ${args.map(redact).join(" ")} exited with ${result.status}`);
  return result.stdout ?? "";
}

export function compose(args: string[], env?: NodeJS.ProcessEnv): string {
  return run("docker", ["compose", ...args], { env });
}

/**
 * docker-compose.yml requires POSTGRES_PASSWORD, and Compose checks it even for `down` and `ps`,
 * which create nothing and never read the value. A placeholder lets them work on an install whose
 * .env has no password yet. Not for commands that start containers.
 */
export function readOnlyComposeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, POSTGRES_PASSWORD: base.POSTGRES_PASSWORD || "unused" };
}

/** POSTGRES_PASSWORD as Compose sees it: a shell variable wins over .env. Empty when neither sets it. */
export function configuredPostgresPassword(env: NodeJS.ProcessEnv, envFile = ".env"): string {
  // `??`, not `||`: a shell variable that is set but empty wins in Compose and fails its :? check.
  if (env.POSTGRES_PASSWORD !== undefined) return env.POSTGRES_PASSWORD;
  try {
    return parseDotenv(readFileSync(envFile, "utf8")).POSTGRES_PASSWORD ?? "";
  } catch {
    return "";
  }
}

/**
 * `compose ps` works with the placeholder password, but `compose exec` (dump, restore) would stop
 * with Compose's "run pnpm forgecy init" message, which is a dead end on an existing install.
 */
export function requireComposePassword(password: string): void {
  if (!password)
    throw new Error(
      "POSTGRES_PASSWORD is not set, so Compose cannot reach the running database container. On an install from before this check add POSTGRES_PASSWORD=forgecy to .env to keep the current database (README, Upgrading).",
    );
}

/** True when the Compose `postgres` service is running, so dumps go through the container. */
export function composePostgresRunning(): boolean {
  const res = spawnSync("docker", ["compose", "ps", "--status", "running", "--services"], {
    encoding: "utf8",
    env: readOnlyComposeEnv(process.env),
  });
  const running = res.status === 0 && res.stdout.split("\n").includes("postgres");
  if (running) requireComposePassword(configuredPostgresPassword(process.env));
  return running;
}

/** Hide credentials in connection strings before they reach logs or error messages. */
export function redact(arg: string): string {
  return arg.replace(/(\w+:\/\/[^:/@]+:)[^@]+@/, "$1***@");
}
