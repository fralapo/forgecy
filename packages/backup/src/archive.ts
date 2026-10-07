/**
 * Backup archives (spec: "Backup"). One .tar.gz with the database dump (`db.sql`), the
 * media files and a manifest, plus a small `<name>.json` next to it so the list does not
 * need to open archives. Used by the worker (Settings › Backup) and by `pnpm forgecy backup`.
 * The .env file is never included: without FORGECY_ENCRYPTION_KEY the BYOK keys in the
 * dump cannot be read.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const BACKUP_FORMAT = 1;
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

/** Runs a command; stderr is kept for the error, with credentials in URLs masked. */
export function runTool(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
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

/** Dumps the database at `databaseUrl` with the local `pg_dump` (same major as the server or newer). */
export function pgDumpTo(databaseUrl: string): (file: string) => Promise<void> {
  return (file) =>
    runTool("pg_dump", ["--clean", "--if-exists", "--no-owner", "--file", file, databaseUrl]);
}

function expiry(kind: BackupKind, createdAt: Date): Date | null {
  return kind === "nightly"
    ? new Date(createdAt.getTime() + NIGHTLY_RETENTION_DAYS * 86_400_000)
    : null;
}

export interface CreateBackupOptions {
  dataDir: string;
  mediaDir: string;
  /** Writes the SQL dump to the given file. */
  dump: (file: string) => Promise<void>;
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
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    createdAt: now.toISOString(),
    media,
    kind: opts.kind,
    appVersion: opts.appVersion ?? null,
    lastMigration: opts.lastMigration ?? null,
    createdBy: opts.createdBy ?? null,
  };
  const work = await mkdtemp(join(tmpdir(), "forgecy-backup-"));
  try {
    await opts.dump(join(work, "db.sql"));
    await writeFile(join(work, "manifest.json"), JSON.stringify(manifest, null, 2));
    const args = ["-czf", partial, "-C", work, "db.sql", "manifest.json"];
    if (media) args.push("-C", dirname(mediaDir), basename(mediaDir));
    await runTool("tar", args);
    await rename(partial, file);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const sizeBytes = (await stat(file)).size;
  await writeFile(`${file}.json`, JSON.stringify({ ...manifest, sizeBytes }, null, 2));
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
