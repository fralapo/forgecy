/** Helpers of the integration tests that need a PostgreSQL server and its client tools. */
import { spawnSync } from "node:child_process";

export const testDatabaseUrl = process.env.FORGECY_TEST_DATABASE_URL;

const major = (tool: string) =>
  Number(/(\d+)\./.exec(spawnSync(tool, ["--version"], { encoding: "utf8" }).stdout ?? "")?.[1]);
/** psql, pg_dump and pg_restore 17+ on PATH. */
export const hasPgTools = ["psql", "pg_dump", "pg_restore"].every((t) => major(t) >= 17);

/** psql -c as `url`; returns stdout, throws with psql's stderr (never the URL). */
export function psql(url: string, sql: string): string {
  const res = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", sql, url], {
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout.trim();
}

export function withDb(url: string, db: string, user?: { name: string; password: string }): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user.name;
    u.password = user.password;
  }
  return u.toString();
}
