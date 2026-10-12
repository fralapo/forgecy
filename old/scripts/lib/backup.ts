/**
 * Backup and restore (spec: "Backup"). One .tar.gz with the database dump, the media
 * files and a manifest. Works against the Compose stack or a local DATABASE_URL.
 * New backups hold a custom-format dump restored with pg_restore; plain-SQL backups made
 * before ADR 0019 still restore with psql, as they always did.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  backupsDir,
  checksumMatches,
  createBackupArchive,
  extractedDump,
  pgRestoreArgs,
  type BackupManifest,
} from "../../packages/backup/src/archive";
import {
  restoreDatabaseUrl,
  restoreOwnershipSql,
  restoreRoleName,
  withoutExtensionEntries,
  withoutExtensionStatements,
} from "../../packages/backup/src/restore-role";
import { assertSafeDumpFile, assertSafeDumpText } from "../../packages/backup/src/safe-dump";
import { extractBackupArchive } from "../../packages/backup/src/safe-tar";
import { composePostgresRunning, run } from "./shell";

const PG_IMAGE = "pgvector/pgvector:pg17";
const PG_MAJOR = 17;
const dataDir = resolve(process.env.FORGECY_DATA_DIR ?? "./data");
const mediaDir = resolve(process.env.MEDIA_ROOT ?? join(dataDir, "media"));

function pgUser(): string {
  return process.env.POSTGRES_USER ?? "forgecy";
}
function pgDb(): string {
  return process.env.POSTGRES_DB ?? "forgecy";
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is not set and the Compose postgres service is not running");
  return url;
}

/**
 * Who the tools connect as: `asUrl` when given (the restore role), else the Compose superuser
 * (inside the postgres container, where both `localhost` and the service name `postgres` reach
 * the server) or DATABASE_URL. psql, pg_dump and pg_restore all read `-U` and `-d` this way.
 */
function connection(compose: boolean, asUrl?: string): { user: string[]; dbname: string } {
  if (asUrl) return { user: [], dbname: asUrl };
  return compose ? { user: ["-U", pgUser()], dbname: pgDb() } : { user: [], dbname: databaseUrl() };
}

function target(compose: boolean, asUrl?: string): string[] {
  const { user, dbname } = connection(compose, asUrl);
  return [...user, "-d", dbname];
}

/**
 * Runs a PostgreSQL client tool where it reaches the database: inside the Compose postgres
 * container when it runs, else the host's own tool (17+), else the server's image with host
 * networking (pg_dump refuses to dump a newer server). `files` are local files the tool reads:
 * they are copied into the container or mounted, and `args` gets the path the tool sees for each.
 * `stdout` is a local file the output is written to.
 */
function pgTool(
  tool: "pg_dump" | "pg_restore" | "psql",
  args: (path: (file: string) => string) => string[],
  opts: {
    compose: boolean;
    files?: string[];
    stdout?: string;
    input?: string;
    env?: Record<string, string>;
  },
): void {
  const files = opts.files ?? [];
  // The container does not inherit our environment: pass the variables with -e.
  const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const out = opts.stdout === undefined ? undefined : openSync(opts.stdout, "w");
  const io = { input: opts.input, stdout: out };
  try {
    if (opts.compose) {
      const dir = `/tmp/forgecy-${randomBytes(8).toString("hex")}`;
      const at = (file: string) => `${dir}/${basename(file)}`;
      const exec = (...a: string[]) => ["compose", "exec", "-T", ...a];
      // ponytail: files are copied in on every call (up to 3 per restore); stage them once per
      // restore if database dumps get large enough for that to matter.
      if (files.length) run("docker", exec("postgres", "mkdir", "-m", "700", dir));
      try {
        for (const f of files) run("docker", ["compose", "cp", f, `postgres:${at(f)}`]);
        run("docker", exec(...envArgs, "postgres", tool, ...args(at)), io);
      } finally {
        if (files.length) run("docker", exec("postgres", "rm", "-rf", dir));
      }
      return;
    }
    const local = spawnSync(tool, ["--version"], { encoding: "utf8" });
    const localMajor = Number(/(\d+)\./.exec(local.stdout ?? "")?.[1] ?? 0);
    if (local.status === 0 && localMajor >= PG_MAJOR) {
      run(
        tool,
        args((f) => f),
        { ...io, env: opts.env },
      );
      return;
    }
    const at = (file: string) => `/forgecy/${basename(file)}`;
    const mounts = files.flatMap((f) => ["-v", `${resolve(f)}:${at(f)}:ro`]);
    run(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--network",
        "host",
        ...envArgs,
        ...mounts,
        PG_IMAGE,
        tool,
        ...args(at),
      ],
      io,
    );
  } finally {
    if (out !== undefined) closeSync(out);
  }
}

/** Runs `sql` through psql as one transaction (plain backups and the ownership step). */
function loadDatabase(sql: string, asUrl?: string): void {
  const compose = composePostgresRunning();
  const flags = ["-X", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-f", "-"];
  // The scanner reads the dump as UTF-8, so psql must too.
  pgTool("psql", () => [...flags, ...target(compose, asUrl)], {
    compose,
    input: sql,
    env: { PGCLIENTENCODING: "UTF8" },
  });
}

export async function backup(): Promise<string> {
  const file = await createBackupArchive({
    dataDir,
    mediaDir,
    kind: "cli",
    dump: {
      format: "custom",
      write: async (out) => {
        const compose = composePostgresRunning();
        pgTool("pg_dump", () => ["--format=custom", ...target(compose)], { compose, stdout: out });
      },
    },
  });
  return join(backupsDir(dataDir), file.name);
}

/**
 * ADR 0019: the scanner reads the SQL rendering of this very archive file with this very list
 * (no connection needed), then pg_restore sends the same statements through libpq, where psql
 * meta-commands do not exist. `own` is an empty folder of ours, not the extracted tree.
 */
async function restoreCustomDump(archive: string, own: string, restoreUrl?: string) {
  const compose = composePostgresRunning();
  let list: string | undefined;
  if (restoreUrl) {
    list = join(own, "db.list");
    pgTool("pg_restore", (at) => ["--list", at(archive)], {
      compose,
      files: [archive],
      stdout: list,
    });
    writeFileSync(list, withoutExtensionEntries(readFileSync(list, "utf8")));
  }
  const files = list ? [archive, list] : [archive];
  const listAt = (at: (f: string) => string) => (list ? at(list) : undefined);
  const rendered = join(own, "db.rendered.sql");
  pgTool("pg_restore", (at) => pgRestoreArgs(at(archive), { file: "-", list: listAt(at) }), {
    compose,
    files,
    stdout: rendered,
  });
  await assertSafeDumpFile(rendered);
  rmSync(rendered);
  if (restoreUrl) loadDatabase(restoreOwnershipSql(restoreRoleName(restoreUrl)));
  const { user, dbname } = connection(compose, restoreUrl);
  pgTool(
    "pg_restore",
    (at) => [...user, ...pgRestoreArgs(at(archive), { databaseUrl: dbname, list: listAt(at) })],
    { compose, files },
  );
}

export async function restore(archive: string): Promise<void> {
  // ADR 0018: optional, checked before anything is read.
  const restoreUrl = restoreDatabaseUrl(process.env.FORGECY_RESTORE_DATABASE_URL);
  const work = mkdtempSync(join(tmpdir(), "forgecy-restore-"));
  const own = mkdtempSync(join(tmpdir(), "forgecy-pg-restore-"));
  try {
    const file = resolve(archive);
    // Same checks as the web restore: checksum, no links in the archive, no owners restored.
    if (!(await checksumMatches(file)))
      throw new Error(
        "The backup does not match its recorded checksum: it may be corrupted or changed. If this backup was made before checksums were recorded, delete its .json sidecar file",
      );
    await extractBackupArchive(file, work);
    const manifest = JSON.parse(
      readFileSync(join(work, "manifest.json"), "utf8"),
    ) as BackupManifest;
    // Refuses an unknown format, and a dump file other than the one the manifest names.
    const dump = extractedDump(work, manifest);
    if (dump.db === "custom") await restoreCustomDump(dump.file, own, restoreUrl);
    else {
      // No psql meta-commands (\!, \copy, \i...) in a backup that may come from elsewhere.
      // The string scanned is the very string sent to psql.
      const text = readFileSync(dump.file, "utf8");
      const sql = restoreUrl ? withoutExtensionStatements(text) : text;
      await assertSafeDumpText(sql);
      // The restore role must own what the dump drops; fixed SQL, run as the superuser.
      if (restoreUrl) loadDatabase(restoreOwnershipSql(restoreRoleName(restoreUrl)));
      loadDatabase(sql, restoreUrl);
    }
    const mediaName = basename(mediaDir);
    if (manifest.media && existsSync(join(work, mediaName))) {
      mkdirSync(mediaDir, { recursive: true });
      // Plain files and folders only (checked above): nothing to dereference or preserve.
      cpSync(join(work, mediaName), mediaDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(own, { recursive: true, force: true });
  }
}
