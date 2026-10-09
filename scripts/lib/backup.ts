/**
 * Backup and restore (spec: "Backup"). One .tar.gz with the database dump, the media
 * files and a manifest. Works against the Compose stack or a local DATABASE_URL.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
} from "../../packages/backup/src/archive";
import { assertSafeDumpText } from "../../packages/backup/src/safe-dump";
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

function dumpDatabase(): string {
  if (composePostgresRunning()) {
    return run(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "pg_dump",
        "-U",
        pgUser(),
        "-d",
        pgDb(),
        "--clean",
        "--if-exists",
        "--no-owner",
      ],
      {
        capture: true,
      },
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is not set and the Compose postgres service is not running");
  return pgClientTool("pg_dump", ["--clean", "--if-exists", "--no-owner", url], { capture: true });
}

function loadDatabase(sql: string): void {
  if (composePostgresRunning()) {
    run(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "-e",
        "PGCLIENTENCODING=UTF8",
        "postgres",
        "psql",
        "-X",
        "--single-transaction",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        pgUser(),
        "-d",
        pgDb(),
        "-f",
        "-",
      ],
      { input: sql },
    );
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is not set and the Compose postgres service is not running");
  // The scanner reads the dump as UTF-8, so psql must too.
  pgClientTool("psql", ["-X", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-f", "-", url], {
    input: sql,
    env: { PGCLIENTENCODING: "UTF8" },
  });
}

/**
 * pg_dump refuses to dump a newer server, so when the host client is missing or older
 * we run the same tool from the server's image with host networking.
 */
function pgClientTool(
  tool: "pg_dump" | "psql",
  args: string[],
  options: { capture?: boolean; input?: string; env?: Record<string, string> },
): string {
  const local = spawnSync(tool, ["--version"], { encoding: "utf8" });
  const localMajor = Number(/(\d+)\./.exec(local.stdout ?? "")?.[1] ?? 0);
  if (local.status === 0 && localMajor >= PG_MAJOR) return run(tool, args, options);
  // The container does not inherit our environment: pass the variables with -e.
  const envArgs = Object.entries(options.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return run(
    "docker",
    ["run", "--rm", "-i", "--network", "host", ...envArgs, PG_IMAGE, tool, ...args],
    { capture: options.capture, input: options.input },
  );
}

export async function backup(): Promise<string> {
  const file = await createBackupArchive({
    dataDir,
    mediaDir,
    kind: "cli",
    dump: async (target) => writeFileSync(target, dumpDatabase()),
  });
  return join(backupsDir(dataDir), file.name);
}

export async function restore(archive: string): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "forgecy-restore-"));
  try {
    const file = resolve(archive);
    // Same checks as the web restore: checksum, no links in the archive, no owners restored.
    if (!(await checksumMatches(file)))
      throw new Error(
        "The backup does not match its recorded checksum: it may be corrupted or changed. If this backup was made before checksums were recorded, delete its .json sidecar file",
      );
    await extractBackupArchive(file, work);
    const manifest = JSON.parse(readFileSync(join(work, "manifest.json"), "utf8")) as {
      format: number;
      media: boolean;
    };
    if (manifest.format !== 1) throw new Error(`Unsupported backup format ${manifest.format}`);
    // No psql meta-commands (\!, \copy, \i...) in a backup that may come from elsewhere.
    // The string scanned is the very string sent to psql.
    const sql = readFileSync(join(work, "db.sql"), "utf8");
    await assertSafeDumpText(sql);
    loadDatabase(sql);
    const mediaName = basename(mediaDir);
    if (manifest.media && existsSync(join(work, mediaName))) {
      mkdirSync(mediaDir, { recursive: true });
      // Plain files and folders only (checked above): nothing to dereference or preserve.
      cpSync(join(work, mediaName), mediaDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
