import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getLocalDataDirectory } from "../local-db";
import { createWorkspaceArchive } from "./archive";

export const AUTOMATIC_BACKUP_INTERVAL_MS = 8 * 60 * 60 * 1000;
export const AUTOMATIC_BACKUP_RETENTION = 7;
const BACKUP_NAME = /^forgecy-auto-(\d{13})-([a-f0-9]{12})\.forgecy\.zip$/;

export type AutomaticBackupInfo = { id: string; createdAt: string; size: number; hashPrefix: string };

declare global {
  var __forgecyAutomaticBackupSchedulerStarted: boolean | undefined;
  var __forgecyAutomaticBackupInProgress: boolean | undefined;
}

function backupDirectory() {
  const directory = join(getLocalDataDirectory(), "automatic-backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch { /* Windows inherits the private app data ACL. */ }
  return directory;
}

function isBackupId(value: string) { return BACKUP_NAME.test(value); }

export function listAutomaticBackups(): AutomaticBackupInfo[] {
  const directory = backupDirectory();
  return readdirSync(directory).flatMap((id) => {
    const match = BACKUP_NAME.exec(id);
    if (!match) return [];
    try {
      const stat = lstatSync(join(directory, id));
      if (!stat.isFile() || stat.isSymbolicLink()) return [];
      return [{ id, createdAt: new Date(Number(match[1])).toISOString(), size: stat.size, hashPrefix: match[2] }];
    } catch { return []; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createAutomaticBackup(): Promise<AutomaticBackupInfo> {
  if (globalThis.__forgecyAutomaticBackupInProgress)
    throw new Error("È già in corso un backup locale.");
  globalThis.__forgecyAutomaticBackupInProgress = true;
  try {
    const { archive, manifest } = await createWorkspaceArchive();
    const directory = backupDirectory();
    const timestamp = Date.now();
    const id = `forgecy-auto-${timestamp}-${manifest.hash.slice(0, 12)}.forgecy.zip`;
    const target = join(directory, id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, archive, { mode: 0o600, flag: "wx" });
      try { chmodSync(temporary, 0o600); } catch { /* Windows inherits the private app data ACL. */ }
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }

    for (const expired of listAutomaticBackups().slice(AUTOMATIC_BACKUP_RETENTION)) {
      if (isBackupId(expired.id)) rmSync(join(directory, expired.id), { force: true });
    }
    return { id, createdAt: new Date(timestamp).toISOString(), size: archive.byteLength, hashPrefix: manifest.hash.slice(0, 12) };
  } finally { globalThis.__forgecyAutomaticBackupInProgress = false; }
}

export function readAutomaticBackup(id: string): Buffer {
  if (!isBackupId(id)) throw new Error("Backup locale non valido.");
  return readFileSync(join(backupDirectory(), id));
}

export function startAutomaticBackupScheduler() {
  if (globalThis.__forgecyAutomaticBackupSchedulerStarted) return;
  globalThis.__forgecyAutomaticBackupSchedulerStarted = true;
  const runIfDue = async () => {
    if (globalThis.__forgecyAutomaticBackupInProgress) return;
    try {
      const latest = listAutomaticBackups()[0];
      if (latest && Date.now() - Date.parse(latest.createdAt) < AUTOMATIC_BACKUP_INTERVAL_MS) return;
      await createAutomaticBackup();
    }
    catch (error) { console.error("[automatic backup] Backup locale non riuscito:", error instanceof Error ? error.message : "errore"); }
  };
  void runIfDue();
  const timer = setInterval(() => void runIfDue(), 15 * 60 * 1000);
  timer.unref?.();
}
