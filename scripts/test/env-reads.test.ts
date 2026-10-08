import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers";

/**
 * Configuration is read in packages/core (`loadEnv`, `loadToolEnv`). Every file below reads
 * the environment on purpose; a new entry needs a reason a reviewer can accept.
 *
 * Deliberately not scanned: `scripts/` (the ops CLI bootstraps the environment before any
 * configuration exists), `drizzle.config.ts` and other package-root files outside `src/`.
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
    "default `env` parameter, injectable in tests; it also reads PLAYWRIGHT_BROWSERS_PATH, a Playwright variable that is not Forgecy configuration (FORGECY_CHROMIUM_PATH goes through loadToolEnv)",
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

/** Ways a line of code can reach the environment (comments are skipped by the caller). */
const ENV_ACCESS = [
  // process.env.NODE_ENV is a framework constant (bundlers inline it).
  /process\.env(?!\.NODE_ENV\b)/,
  /import\.meta\.env/,
  /process\s*\[\s*["']env["']\s*\]/,
  // `const p = process;` / `{ env } = process,` / `f(x = process)`: the env is then one step away.
  /=\s*process\s*[;,)]/,
];

/** 1-based numbers of the lines of `text` that read the environment. */
function envReadLines(text: string): number[] {
  const lines: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (ENV_ACCESS.some((re) => re.test(line))) lines.push(i + 1);
  });
  return lines;
}

describe("envReadLines", () => {
  it.each([
    "const a = process.env.FOO;",
    "const { FOO } = process.env;",
    "spawn(cmd, { env: { ...process.env } });",
    "const a = import.meta.env.VITE_X;",
    'const a = process["env"].FOO;',
    "const a = process['env'].FOO;",
    "const p = process;",
    "const { env } = process;",
    "const q = foo(a, b = process);",
    "const x = [process, 1]; const y = process;",
  ])("flags %s", (line) => {
    expect(envReadLines(line)).toEqual([1]);
  });

  it.each([
    "if (process.env.NODE_ENV !== 'production') cache = undefined;",
    "process.exit(0);",
    "process.on('SIGTERM', stop);",
    "const dir = process.cwd();",
    "// process.env.FOO in a comment",
    " * process.env.FOO in a doc comment",
    "/* process.env.FOO */",
    "const processed = envelope;",
    "const ok = a == process.pid;",
  ])("ignores %s", (line) => {
    expect(envReadLines(line)).toEqual([]);
  });

  it("reports line numbers across CRLF and LF text", () => {
    expect(envReadLines("a;\r\nprocess.env.X;\nb;\r\nconst p = process;")).toEqual([2, 4]);
  });
});

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

/** Runtime code that reads the environment: repo-relative path to line numbers. */
function envReads(): Map<string, number[]> {
  const found = new Map<string, number[]>();
  for (const root of roots) {
    try {
      readdirSync(root);
    } catch {
      continue; // package without src/
    }
    for (const file of walk(root)) {
      const lines = envReadLines(readFileSync(file, "utf8"));
      if (lines.length) found.set(relative(repoRoot, file).split(sep).join("/"), lines);
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

  it("lists only files that still read the environment", () => {
    expect([...ALLOWED.keys()].filter((rel) => !reads.has(rel))).toEqual([]);
  });
});
