/**
 * Backup and restore (spec: "Backup"). One .tar.gz with the database dump, the media
 * files and a manifest. Works against the Compose stack or a local DATABASE_URL.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backupsDir, createBackupArchive } from "../../packages/backup/src/archive";
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
        "postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        pgUser(),
        "-d",
        pgDb(),
      ],
      { input: sql },
    );
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is not set and the Compose postgres service is not running");
  pgClientTool("psql", ["-v", "ON_ERROR_STOP=1", url], { input: sql });
}

/**
 * pg_dump refuses to dump a newer server, so when the host client is missing or older
 * we run the same tool from the server's image with host networking.
 */
function pgClientTool(
  tool: "pg_dump" | "psql",
  args: string[],
  options: { capture?: boolean; input?: string },
): string {
  const local = spawnSync(tool, ["--version"], { encoding: "utf8" });
  const localMajor = Number(/(\d+)\./.exec(local.stdout ?? "")?.[1] ?? 0);
  if (local.status === 0 && localMajor >= PG_MAJOR) return run(tool, args, options);
  return run(
    "docker",
    ["run", "--rm", "-i", "--network", "host", PG_IMAGE, tool, ...args],
    options,
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
    run("tar", ["-xzf", resolve(archive), "-C", work]);
    const manifest = JSON.parse(readFileSync(join(work, "manifest.json"), "utf8")) as {
      format: number;
      media: boolean;
    };
    if (manifest.format !== 1) throw new Error(`Unsupported backup format ${manifest.format}`);
    loadDatabase(readFileSync(join(work, "db.sql"), "utf8"));
    const mediaName = mediaDir.split("/").pop()!;
    if (manifest.media && existsSync(join(work, mediaName))) {
      mkdirSync(mediaDir, { recursive: true });
      const res = spawnSync("cp", ["-a", `${join(work, mediaName)}/.`, mediaDir], {
        stdio: "inherit",
      });
      if (res.status !== 0) throw new Error("Copying media files failed");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
