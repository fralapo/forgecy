/**
 * Backup archives (spec: "Backup"). One .tar.gz with the database dump (`db.dump`, a
 * `pg_dump -Fc` archive; `db.sql`, plain SQL, in backups made before ADR 0019), the media
 * files and a manifest, plus a small `<name>.json` next to it so the list does not need to
 * open archives. Used by the worker (Settings › Backup) and by `pnpm forgecy backup`.
 * The .env file is never included: without FORGECY_ENCRYPTION_KEY the BYOK keys in the
 * dump cannot be read.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Format of the backups this version writes. 1: plain SQL (`db.sql`), no `db` field, still
 * restored. 2: custom-format dump (`db.dump`, `db: "custom"`); a version that knows only 1
 * reports it as an unknown format before anything runs (ADR 0019).
 */
export const BACKUP_FORMAT = 2;
export type DbDumpFormat = "plain" | "custom";
/** The only database file each dump type may come in. */
export const DB_FILES: Readonly<Record<DbDumpFormat, string>> = {
  plain: "db.sql",
  custom: "db.dump",
};
export const backupKinds = [
  "manual",
  "nightly",
  "pre_restore",
  "pre_import",
  "cli",
  "upload",
] as const;
export type BackupKind = (typeof backupKinds)[number];
/** Nightly backups are deleted after this many days; the others never expire. */
export const NIGHTLY_RETENTION_DAYS = 30;

export interface BackupManifest {
  format: number;
  /** Absent in format 1 (plain SQL); "custom" in format 2. Read it with backupDbFormat. */
  db?: DbDumpFormat;
  createdAt: string;
  media: boolean;
  kind?: BackupKind;
  appVersion?: string | null;
  lastMigration?: string | null;
  createdBy?: string | null;
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: Date;
  kind: BackupKind;
  media: boolean;
  appVersion: string | null;
  lastMigration: string | null;
  createdBy: string | null;
  expiresAt: Date | null;
}

/**
 * The dump type of a backup, from a manifest that may come from elsewhere: format 1 with no
 * `db` (or "plain") is plain SQL, format 2 with `db: "custom"` a custom-format dump. Anything
 * else is refused, so the manifest can only ever pick one of the two fixed file names.
 */
export function backupDbFormat(manifest: Pick<BackupManifest, "format" | "db">): DbDumpFormat {
  const { format, db } = manifest;
  if (format === 1 && (db === undefined || db === "plain")) return "plain";
  if (format === 2 && db === "custom") return "custom";
  throw new Error(
    `Unsupported backup format ${String(format).slice(0, 20)}${db === undefined ? "" : ` (${String(db).slice(0, 20)})`}`,
  );
}

/** The dump of an extracted backup: exactly the file its manifest names, and not the other. */
export function extractedDump(
  work: string,
  manifest: Pick<BackupManifest, "format" | "db">,
): { db: DbDumpFormat; file: string } {
  const db = backupDbFormat(manifest);
  const other = DB_FILES[db === "plain" ? "custom" : "plain"];
  if (!existsSync(join(work, DB_FILES[db])) || existsSync(join(work, other)))
    throw new Error("The backup does not hold exactly the database dump its manifest names");
  return { db, file: join(work, DB_FILES[db]) };
}

const NAME_RE = /^forgecy-[0-9A-Za-z-]+\.tar\.gz$/;

export function backupsDir(dataDir: string): string {
  return join(resolve(dataDir), "backups");
}

/** Only names Forgecy writes, so a name from a request can never leave the backups folder. */
export function isBackupName(name: string): boolean {
  return NAME_RE.test(name) && basename(name) === name;
}

export function backupPath(dataDir: string, name: string): string {
  if (!isBackupName(name)) throw new Error("Invalid backup name");
  return join(backupsDir(dataDir), name);
}

/**
 * A TAR_OPTIONS in the environment could add flags (for example --absolute-names or
 * --dereference) to every tar call; blank it so only our arguments apply.
 */
export const TAR_ENV = { TAR_OPTIONS: "" };

export interface TarHost {
  /** GNU tar (Linux, MSYS/Git Bash on Windows) rather than bsdtar (macOS, Windows System32). */
  gnu: boolean;
  windows: boolean;
}

let host: TarHost | undefined;
function tarHost(): TarHost {
  host ??= {
    gnu: /GNU tar/.test(
      spawnSync("tar", ["--version"], { encoding: "utf8", env: { ...process.env, ...TAR_ENV } })
        .stdout ?? "",
    ),
    windows: process.platform === "win32",
  };
  return host;
}

/**
 * The arguments of a tar call that names archive files and folders. GNU tar reads `C:\x` as
 * the host `C` unless --force-local (which bsdtar rejects), and on Windows the MSYS build
 * cannot `-C` into a backslash path, so paths are given with forward slashes there (both tars
 * accept them). On other systems a backslash is a valid file name character and is kept.
 */
export function tarArgs(args: readonly string[], on: TarHost = tarHost()): string[] {
  const out = on.gnu ? ["--force-local", ...args] : [...args];
  return on.windows ? out.map((a) => a.replaceAll("\\", "/")) : out;
}

/** GNU tar only: bsdtar rejects the flag, and its archives are still checked at restore. */
const hardDereferenceFlag = (): string[] => (tarHost().gnu ? ["--hard-dereference"] : []);

/** Runs a command; stderr is kept for the error, with credentials in URLs masked. */
export function runTool(cmd: string, args: string[], env?: Record<string, string>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "ignore", "pipe"],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(
            new Error(`${cmd} exited with ${code}: ${stderr.replace(/\w+:\/\/[^@\s]+@/g, "***@")}`),
          ),
    );
  });
}

/** Writes the database dump to a file, in the format it declares. */
export interface DbDump {
  format: DbDumpFormat;
  write: (file: string) => Promise<void>;
}

/**
 * Dumps the database at `databaseUrl` with the local `pg_dump` (same major as the server or
 * newer). Custom format by default (ADR 0019); "plain" is kept for tests of older backups.
 * `--clean --if-exists --no-owner` apply to a custom dump at restore time (pgRestoreArgs).
 */
export function pgDumpTo(databaseUrl: string, format: DbDumpFormat = "custom"): DbDump {
  const args = format === "custom" ? ["--format=custom"] : ["--clean", "--if-exists", "--no-owner"];
  return {
    format,
    write: (file) => runTool("pg_dump", [...args, "--file", file, databaseUrl]),
  };
}

/**
 * pg_restore arguments, shared by the worker and the CLI. The same options for the SQL
 * rendering the scanner reads (`file`, no connection) and for the restore (`databaseUrl`):
 * only the connection, one transaction for the whole archive and the stop at the first error
 * are added, like `psql -X --single-transaction -v ON_ERROR_STOP=1` for plain backups.
 * `--single-transaction` is left out of the rendering because there it only adds BEGIN/COMMIT.
 */
export function pgRestoreArgs(
  archive: string,
  to: { file: string; list?: string } | { databaseUrl: string; list?: string },
): string[] {
  return [
    "--clean",
    "--if-exists",
    "--no-owner",
    ...(to.list ? ["--use-list", to.list] : []),
    ...("file" in to
      ? ["--file", to.file]
      : ["--single-transaction", "--exit-on-error", "--dbname", to.databaseUrl]),
    archive,
  ];
}

/** SHA-256 of a file, streamed so a multi-gigabyte archive never loads into memory. */
export async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * True when the checksum recorded at creation/upload matches the file. Only a missing sidecar
 * (a backup copied in by hand) passes without one; an unreadable or malformed sidecar, or one
 * without a hash, fails closed so corruption detection is never silently switched off.
 */
export async function checksumMatches(file: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(`${file}.json`, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT";
  }
  let expected: unknown;
  try {
    expected = (JSON.parse(raw) as { sha256?: unknown }).sha256;
  } catch {
    return false;
  }
  return typeof expected === "string" && (await fileSha256(file)) === expected;
}

function expiry(kind: BackupKind, createdAt: Date): Date | null {
  return kind === "nightly"
    ? new Date(createdAt.getTime() + NIGHTLY_RETENTION_DAYS * 86_400_000)
    : null;
}

export interface CreateBackupOptions {
  dataDir: string;
  mediaDir: string;
  /** Writes the database dump to the given file. */
  dump: DbDump;
  kind: BackupKind;
  includeMedia?: boolean;
  createdBy?: string | null;
  appVersion?: string | null;
  lastMigration?: string | null;
  now?: Date;
}

export async function createBackupArchive(opts: CreateBackupOptions): Promise<BackupFile> {
  const now = opts.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const dir = backupsDir(opts.dataDir);
  await mkdir(dir, { recursive: true });
  let name = `forgecy-${stamp}.tar.gz`;
  // Two backups in the same millisecond must not overwrite each other.
  for (let i = 2; existsSync(join(dir, name)) || existsSync(join(dir, `${name}.partial`)); i++)
    name = `forgecy-${stamp}-${i}.tar.gz`;
  const file = join(dir, name);
  // Written under another name and renamed at the end: the list never shows a half archive.
  const partial = `${file}.partial`;
  const mediaDir = resolve(opts.mediaDir);
  const media = (opts.includeMedia ?? true) && existsSync(mediaDir);
  const custom = opts.dump.format === "custom";
  // A plain dump gets exactly the manifest of a format 1 backup.
  const manifest: BackupManifest = {
    format: custom ? BACKUP_FORMAT : 1,
    ...(custom ? { db: "custom" as const } : {}),
    createdAt: now.toISOString(),
    media,
    kind: opts.kind,
    appVersion: opts.appVersion ?? null,
    lastMigration: opts.lastMigration ?? null,
    createdBy: opts.createdBy ?? null,
  };
  const work = await mkdtemp(join(tmpdir(), "forgecy-backup-"));
  try {
    const dbFile = DB_FILES[opts.dump.format];
    await opts.dump.write(join(work, dbFile));
    await writeFile(join(work, "manifest.json"), JSON.stringify(manifest, null, 2));
    // Hard-linked media files are stored as plain files, or restore would refuse the archive.
    const args = ["-czf", partial, ...hardDereferenceFlag(), "-C", work, dbFile, "manifest.json"];
    if (media) args.push("-C", dirname(mediaDir), basename(mediaDir));
    await runTool("tar", tarArgs(args), TAR_ENV);
    await rename(partial, file);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const sizeBytes = (await stat(file)).size;
  const sha256 = await fileSha256(file);
  await writeFile(`${file}.json`, JSON.stringify({ ...manifest, sizeBytes, sha256 }, null, 2));
  return {
    name,
    sizeBytes,
    createdAt: now,
    kind: opts.kind,
    media,
    appVersion: manifest.appVersion ?? null,
    lastMigration: manifest.lastMigration ?? null,
    createdBy: manifest.createdBy ?? null,
    expiresAt: expiry(opts.kind, now),
  };
}

/** Completed backups, newest first. Archives made by older CLIs have no sidecar and show as `cli`. */
export async function listBackups(dataDir: string): Promise<BackupFile[]> {
  const dir = backupsDir(dataDir);
  let names: string[];
  try {
    names = (await readdir(dir)).filter(isBackupName);
  } catch {
    return [];
  }
  const out = await Promise.all(
    names.map(async (name): Promise<BackupFile> => {
      const file = join(dir, name);
      const info = await stat(file);
      let meta: Partial<BackupManifest> = {};
      try {
        meta = JSON.parse(await readFile(`${file}.json`, "utf8")) as BackupManifest;
      } catch {
        // No sidecar: an archive written by an older `pnpm forgecy backup`.
      }
      const createdAt = meta.createdAt ? new Date(meta.createdAt) : info.mtime;
      const kind = backupKinds.find((k) => k === meta.kind) ?? "cli";
      return {
        name,
        sizeBytes: info.size,
        createdAt,
        kind,
        media: meta.media ?? true,
        appVersion: meta.appVersion ?? null,
        lastMigration: meta.lastMigration ?? null,
        createdBy: meta.createdBy ?? null,
        expiresAt: expiry(kind, createdAt),
      };
    }),
  );
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function deleteBackup(dataDir: string, name: string): Promise<void> {
  const file = backupPath(dataDir, name);
  await rm(file, { force: true });
  await rm(`${file}.json`, { force: true });
}

/** Deletes nightly backups past their retention; returns their names. */
export async function pruneExpiredBackups(dataDir: string, now = new Date()): Promise<string[]> {
  const expired = (await listBackups(dataDir)).filter((b) => b.expiresAt && b.expiresAt <= now);
  for (const b of expired) await deleteBackup(dataDir, b.name);
  return expired.map((b) => b.name);
}
