/**
 * Restore from a backup archive (spec: Flow K). Validation reads only the manifest;
 * the restore itself replaces the database and copies the media files back. Because
 * the jobs table is replaced too, progress is kept in `data/backups/restore-status.json`.
 */
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { appSettings, eq, type Database } from "@forgecy/db";
import {
  BACKUP_FORMAT,
  backupPath,
  backupsDir,
  checksumMatches,
  fileSha256,
  runTool,
  type BackupFile,
  type BackupManifest,
} from "./archive";
import { stripExtensionStatements } from "./restore-role";
import { assertSafeDumpFile } from "./safe-dump";
import { assertPlainTar, extractBackupArchive, UnsafeArchiveError } from "./safe-tar";

export type RestoreProblem =
  "unreadable" | "format" | "newer_version" | "checksum_mismatch" | "unsafe";

export class BackupChecksumError extends Error {
  constructor() {
    super(
      "The backup does not match its recorded checksum: it may be corrupted or changed. If this backup was made before checksums were recorded, delete its .json sidecar file",
    );
    this.name = "BackupChecksumError";
  }
}

export interface BackupInspection {
  name: string;
  manifest: BackupManifest | null;
  problems: RestoreProblem[];
  /** Migrations this version will apply after the restore. */
  migrationsToApply: number;
}

/**
 * Checks a backup before restoring it: readable manifest, known format, and not made by
 * a newer Forgecy (its last migration must be one this version ships).
 */
export async function inspectBackup(
  dataDir: string,
  name: string,
  shipped: readonly { tag: string }[],
): Promise<BackupInspection> {
  const file = backupPath(dataDir, name);
  const work = await mkdtemp(join(tmpdir(), "forgecy-inspect-"));
  try {
    let manifest: BackupManifest;
    try {
      // One extra decompression pass so a link anywhere is reported now, not after the confirm.
      await assertPlainTar(file);
      await extractBackupArchive(file, work, ["manifest.json"]);
      manifest = JSON.parse(await readFile(join(work, "manifest.json"), "utf8")) as BackupManifest;
    } catch (err) {
      const problem = err instanceof UnsafeArchiveError ? "unsafe" : "unreadable";
      return { name, manifest: null, problems: [problem], migrationsToApply: 0 };
    }
    const problems: RestoreProblem[] = [];
    if (manifest.format !== BACKUP_FORMAT) problems.push("format");
    // Sidecar written at creation/upload time. It detects corruption and accidental changes,
    // not deliberate tampering by someone who can rewrite the sidecar too.
    if (!(await checksumMatches(file))) problems.push("checksum_mismatch");
    const index = manifest.lastMigration
      ? shipped.findIndex((m) => m.tag === manifest.lastMigration)
      : -1;
    if (manifest.lastMigration && index === -1) problems.push("newer_version");
    // Archives from older CLIs carry no migration: everything is checked again after the restore.
    const migrationsToApply = index === -1 ? 0 : shipped.length - 1 - index;
    return { name, manifest, problems, migrationsToApply };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * psql reads the file as ONE transaction (a failed restore leaves the old data) and ignores
 * ~/.psqlrc. ON_ERROR_STOP=1 is load-bearing for the dump scanner: if the server rejected a
 * `COPY ... FROM stdin;` header, psql would otherwise run the data lines as SQL (and
 * backslash lines as meta-commands) while the scanner had skipped them as COPY data.
 */
export function psqlArgs(file: string, databaseUrl: string): string[] {
  return ["-X", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-q", "-f", file, databaseUrl];
}

/** Loads a SQL file into the database at `databaseUrl` with the local `psql`. */
export function psqlLoadInto(databaseUrl: string): (file: string) => Promise<void> {
  return (file) => runTool("psql", psqlArgs(file, databaseUrl), { PGCLIENTENCODING: "UTF8" });
}

export async function restoreArchive(opts: {
  dataDir: string;
  mediaDir: string;
  name: string;
  load: (sqlFile: string) => Promise<void>;
  /** `load` runs as the FORGECY_RESTORE_DATABASE_URL role: leave out what only a superuser can do. */
  restricted?: boolean;
}): Promise<{ media: boolean }> {
  const file = backupPath(opts.dataDir, opts.name);
  // Before anything is read: the bytes must be the ones recorded when the backup was made.
  if (!(await checksumMatches(file))) throw new BackupChecksumError();
  const work = await mkdtemp(join(tmpdir(), "forgecy-restore-"));
  try {
    await extractBackupArchive(file, work);
    const manifest = JSON.parse(
      await readFile(join(work, "manifest.json"), "utf8"),
    ) as BackupManifest;
    if (manifest.format !== BACKUP_FORMAT)
      throw new Error(`Unsupported backup format ${manifest.format}`);
    // Before the scan, so the scanner reads exactly what psql will.
    if (opts.restricted) await stripExtensionStatements(join(work, "db.sql"));
    // A backup may come from elsewhere: no psql meta-commands (\!, \copy, \i...) get through.
    await assertSafeDumpFile(join(work, "db.sql"));
    await opts.load(join(work, "db.sql"));
    const mediaDir = resolve(opts.mediaDir);
    const extracted = join(work, basename(mediaDir));
    const media = manifest.media && existsSync(extracted);
    if (media) {
      await mkdir(mediaDir, { recursive: true });
      // Plain files and folders only (checked above): nothing to dereference or preserve.
      await cp(extracted, mediaDir, { recursive: true, force: true });
    }
    return { media };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export type RestoreState = "queued" | "running" | "completed" | "failed";

export interface RestoreStatus {
  state: RestoreState;
  backup: string;
  /** Name of the person who started it: the users table may change with the restore. */
  requestedBy: string;
  /** Their user id: everyone else sees the maintenance page while it runs (page 67). */
  requestedById?: string;
  requestedAt: string;
  updatedAt?: string;
  preRestoreBackup?: string;
  finishedAt?: string;
  error?: string;
}

const statusFile = (dataDir: string) => join(backupsDir(dataDir), "restore-status.json");

export async function readRestoreStatus(dataDir: string): Promise<RestoreStatus | null> {
  try {
    return JSON.parse(await readFile(statusFile(dataDir), "utf8")) as RestoreStatus;
  } catch {
    return null;
  }
}

export async function writeRestoreStatus(dataDir: string, status: RestoreStatus): Promise<void> {
  await mkdir(backupsDir(dataDir), { recursive: true });
  const value = { ...status, updatedAt: new Date().toISOString() };
  await writeFile(statusFile(dataDir), JSON.stringify(value, null, 2));
}

/** Fallback when no agency name was ever saved. */
export const DEFAULT_AGENCY_NAME = "Forgecy";

/** The name the Admin types to confirm a restore. */
export async function agencyName(db: Pick<Database, "select">): Promise<string> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "agency"));
  const name = (row?.value as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && name.trim() ? name.trim() : DEFAULT_AGENCY_NAME;
}

/** A restore still in progress, unless it has been silent too long (the worker died). */
export function restoreInProgress(status: RestoreStatus | null, now: Date = new Date()): boolean {
  if (!status || (status.state !== "queued" && status.state !== "running")) return false;
  return now.getTime() - new Date(status.updatedAt ?? status.requestedAt).getTime() < STALE_MS;
}

const STALE_MS = 2 * 60 * 60 * 1000;

/** The uploaded file is not a Forgecy backup (no readable manifest, or another format). */
export class BackupInvalidError extends Error {
  constructor() {
    super("Not a Forgecy backup, or a damaged one");
    this.name = "BackupInvalidError";
  }
}

/**
 * A backup made elsewhere, uploaded from Settings › Backup (page 67). It is written under
 * a temporary name, kept only when its manifest reads as a Forgecy backup, and then
 * listed like the others with the date it was made and the type "upload".
 */
export async function saveUploadedBackup(
  dataDir: string,
  body: NodeJS.ReadableStream | AsyncIterable<Uint8Array>,
  opts: { now?: Date; uploadedBy?: string | null } = {},
): Promise<BackupFile> {
  const now = opts.now ?? new Date();
  const dir = backupsDir(dataDir);
  await mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  let name = `forgecy-upload-${stamp}.tar.gz`;
  for (let i = 2; existsSync(join(dir, name)) || existsSync(join(dir, `${name}.partial`)); i++)
    name = `forgecy-upload-${stamp}-${i}.tar.gz`;
  const file = backupPath(dataDir, name);
  const partial = `${file}.partial`;
  const work = await mkdtemp(join(tmpdir(), "forgecy-upload-"));
  try {
    await pipeline(body, createWriteStream(partial));
    let manifest: BackupManifest;
    try {
      // Uploads are the hostile vector: refuse links and special files up front.
      await assertPlainTar(partial);
      await extractBackupArchive(partial, work, ["manifest.json"]);
      manifest = JSON.parse(await readFile(join(work, "manifest.json"), "utf8")) as BackupManifest;
    } catch {
      throw new BackupInvalidError();
    }
    if (manifest.format !== BACKUP_FORMAT || typeof manifest.createdAt !== "string")
      throw new BackupInvalidError();
    await rename(partial, file);
    const sizeBytes = (await stat(file)).size;
    const sha256 = await fileSha256(file);
    const createdAt = new Date(manifest.createdAt);
    const sidecar: BackupManifest & { sizeBytes: number; sha256: string; uploadedAt: string } = {
      ...manifest,
      kind: "upload",
      createdBy: opts.uploadedBy ?? manifest.createdBy ?? null,
      sizeBytes,
      sha256,
      uploadedAt: now.toISOString(),
    };
    await writeFile(`${file}.json`, JSON.stringify(sidecar, null, 2));
    return {
      name,
      sizeBytes,
      createdAt: Number.isNaN(createdAt.getTime()) ? now : createdAt,
      kind: "upload",
      media: manifest.media,
      appVersion: manifest.appVersion ?? null,
      lastMigration: manifest.lastMigration ?? null,
      createdBy: sidecar.createdBy ?? null,
      expiresAt: null,
    };
  } finally {
    await rm(partial, { force: true });
    await rm(work, { recursive: true, force: true });
  }
}
