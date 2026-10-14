import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { getLocalDataDirectory } from "../local-db";
import { createWorkspaceArchive } from "./archive";

export const DEFAULT_AUTOMATIC_BACKUP_INTERVAL_HOURS = 8;
export const DEFAULT_AUTOMATIC_BACKUP_RETENTION = 7;
export const BACKUP_INTERVAL_OPTIONS_HOURS = [4, 8, 12, 24, 72, 168] as const;
export const BACKUP_RETENTION_OPTIONS = [3, 7, 14, 30] as const;
const BACKUP_NAME = /^forgecy-auto-(\d{13})-([a-f0-9]{12})\.forgecy\.zip$/;
const CONFIG_FILE = "automatic-backup-settings.json";

export type AutomaticBackupInfo = { id: string; createdAt: string; size: number; hashPrefix: string };
export type AutomaticBackupSettings = { directory: string; intervalHours: number; retention: number };

declare global {
  var __forgecyAutomaticBackupSchedulerStarted: boolean | undefined;
  var __forgecyAutomaticBackupInProgress: boolean | undefined;
}

function defaultSettings(): AutomaticBackupSettings {
  return { directory: join(getLocalDataDirectory(), "automatic-backups"), intervalHours: DEFAULT_AUTOMATIC_BACKUP_INTERVAL_HOURS, retention: DEFAULT_AUTOMATIC_BACKUP_RETENTION };
}

function configPath() { return join(getLocalDataDirectory(), CONFIG_FILE); }

function normalizeSettings(input: Partial<AutomaticBackupSettings>): AutomaticBackupSettings {
  const defaults = defaultSettings();
  const requestedDirectory = typeof input.directory === "string" ? input.directory.trim() : "";
  if (requestedDirectory && !isAbsolute(requestedDirectory)) throw new Error("Inserisci un percorso assoluto valido per la cartella dei backup.");
  const directory = requestedDirectory ? resolve(/*turbopackIgnore: true*/ requestedDirectory) : defaults.directory;
  if (directory !== resolve(/*turbopackIgnore: true*/ defaults.directory))
    throw new Error("I backup automatici vengono salvati solo nella cartella locale privata di Forgecy. Per trasferirli, scarica o esporta l'archivio e copialo manualmente.");
  const intervalHours = Number(input.intervalHours);
  const retention = Number(input.retention);
  if (!(BACKUP_INTERVAL_OPTIONS_HOURS as readonly number[]).includes(intervalHours)) throw new Error("Frequenza backup non valida.");
  if (!(BACKUP_RETENTION_OPTIONS as readonly number[]).includes(retention)) throw new Error("Numero di copie da conservare non valido.");
  return { directory, intervalHours, retention };
}

export function getAutomaticBackupSettings(): AutomaticBackupSettings {
  const path = configPath();
  if (!existsSync(path)) return defaultSettings();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<AutomaticBackupSettings>;
    // Older versions allowed choosing a cloud-synced folder. Keep its schedule,
    // but put future automatic backups in this computer's private data folder.
    return normalizeSettings({ ...parsed, directory: defaultSettings().directory });
  } catch (error) {
    console.error("[automatic backup] Configurazione non valida; uso la cartella predefinita.", error instanceof Error ? error.message : "errore");
    return defaultSettings();
  }
}

export function saveAutomaticBackupSettings(input: Partial<AutomaticBackupSettings>): AutomaticBackupSettings {
  const settings = normalizeSettings(input);
  const localDirectory = getLocalDataDirectory();
  mkdirSync(localDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(settings.directory, { recursive: true, mode: 0o700 });
  const probe = join(settings.directory, `.forgecy-write-check-${randomUUID()}`);
  try {
    writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
    rmSync(probe, { force: true });
  } catch {
    rmSync(probe, { force: true });
    throw new Error("Forgecy non riesce a scrivere nella cartella selezionata. Verifica che esista e che il tuo utente abbia i permessi necessari.");
  }
  const temporary = `${configPath()}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(settings), { flag: "wx", mode: 0o600 });
    try { chmodSync(temporary, 0o600); } catch { /* Windows inherits the private app data ACL. */ }
    renameSync(temporary, configPath());
  } finally { rmSync(temporary, { force: true }); }
  return settings;
}

function backupDirectory() {
  const directory = getAutomaticBackupSettings().directory;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch { /* Windows inherits the private app data ACL. */ }
  return directory;
}

function isBackupId(value: string) { return BACKUP_NAME.test(value); }

export function listAutomaticBackups(): AutomaticBackupInfo[] {
  const directory = backupDirectory();
  return readdirSync(/*turbopackIgnore: true*/ directory).flatMap((id) => {
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

    for (const expired of listAutomaticBackups().slice(getAutomaticBackupSettings().retention)) {
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
      const { intervalHours } = getAutomaticBackupSettings();
      if (latest && Date.now() - Date.parse(latest.createdAt) < intervalHours * 60 * 60 * 1000) return;
      await createAutomaticBackup();
    }
    catch (error) { console.error("[automatic backup] Backup locale non riuscito:", error instanceof Error ? error.message : "errore"); }
  };
  void runIfDue();
  const timer = setInterval(() => void runIfDue(), 15 * 60 * 1000);
  timer.unref?.();
}
