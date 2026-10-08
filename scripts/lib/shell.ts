import { spawnSync } from "node:child_process";

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

/** True when the Compose `postgres` service is running, so dumps go through the container. */
export function composePostgresRunning(): boolean {
  const res = spawnSync("docker", ["compose", "ps", "--status", "running", "--services"], {
    encoding: "utf8",
    env: readOnlyComposeEnv(process.env),
  });
  return res.status === 0 && res.stdout.split("\n").includes("postgres");
}

/** Hide credentials in connection strings before they reach logs or error messages. */
export function redact(arg: string): string {
  return arg.replace(/(\w+:\/\/[^:/@]+:)[^@]+@/, "$1***@");
}
