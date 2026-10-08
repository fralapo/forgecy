import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers";

/**
 * Configuration is read in packages/core (`loadEnv`, `loadToolEnv`). Every file below reads
 * `process.env` on purpose; a new entry needs a reason a reviewer can accept.
 */
const ALLOWED = new Map<string, string>([
  ["packages/core/src/env.ts", "the one place that reads the environment"],
  [
    "packages/db/src/client.ts",
    "DATABASE_URL only: the db package must not depend on the full configuration",
  ],
  ["packages/db/src/migrate.ts", "migrate container entry point: DATABASE_URL only"],
  ["packages/db/src/seed.ts", "seed entry point: DATABASE_URL only"],
  [
    "packages/audit/src/crawl/browser.ts",
    "takes `env` as a parameter (default process.env) so tests can inject it",
  ],
  [
    "packages/backup/src/archive.ts",
    "hands the parent environment to the tar/pg_dump child processes, it does not read a setting",
  ],
  [
    "packages/backup/src/safe-tar.ts",
    "hands the parent environment to the tar child process, it does not read a setting",
  ],
  ["apps/web/i18n/request.ts", "TZ is a process setting, not Forgecy configuration"],
  [
    "apps/web/next.config.ts",
    "build-time: runs before loadEnv is usable and reads FORGECY_BASE_URL for the HSTS header (ADR 0014)",
  ],
]);

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo", "coverage", "generated"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    // Tests and specs may read the environment (FORGECY_TEST_* gates, vi.stubEnv).
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) yield full;
  }
}

const roots = [
  ...readdirSync(join(repoRoot, "packages")).map((p) => join(repoRoot, "packages", p, "src")),
  join(repoRoot, "apps/worker/src"),
  join(repoRoot, "apps/web"),
];

/** Lines (`path:line`) of runtime code that read `process.env`, by repo-relative path. */
function envReads(): Map<string, number[]> {
  const found = new Map<string, number[]>();
  for (const root of roots) {
    try {
      readdirSync(root);
    } catch {
      continue; // package without src/
    }
    for (const file of walk(root)) {
      const rel = relative(repoRoot, file).split(sep).join("/");
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          // process.env.NODE_ENV is a framework constant (bundlers inline it).
          if (/process\.env(?!\.NODE_ENV\b)/.test(line))
            found.set(rel, [...(found.get(rel) ?? []), i + 1]);
        });
    }
  }
  return found;
}

const reads = envReads();

describe("configuration access", () => {
  it("goes through @forgecy/core, outside the listed exceptions", () => {
    const offenders = [...reads]
      .filter(([rel]) => !ALLOWED.has(rel))
      .flatMap(([rel, lines]) => lines.map((n) => `${rel}:${n}`));
    expect(offenders).toEqual([]);
  });

  it("lists only files that still read process.env", () => {
    expect([...ALLOWED.keys()].filter((rel) => !reads.has(rel))).toEqual([]);
  });
});
