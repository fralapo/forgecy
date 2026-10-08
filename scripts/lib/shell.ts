import { spawnSync } from "node:child_process";

export function run(
  cmd: string,
  args: string[],
  options: { input?: string; capture?: boolean; env?: Record<string, string> } = {},
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

export function compose(args: string[]): string {
  return run("docker", ["compose", ...args]);
}

/** True when the Compose `postgres` service is running, so dumps go through the container. */
export function composePostgresRunning(): boolean {
  const res = spawnSync("docker", ["compose", "ps", "--status", "running", "--services"], {
    encoding: "utf8",
  });
  return res.status === 0 && res.stdout.split("\n").includes("postgres");
}

/** Hide credentials in connection strings before they reach logs or error messages. */
export function redact(arg: string): string {
  return arg.replace(/(\w+:\/\/[^:/@]+:)[^@]+@/, "$1***@");
}
