import Database from "better-sqlite3";
import { zipSync, unzipSync } from "fflate";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { getLocalDataDirectory, localDb } from "../local-db";
import { withLocalWorkerPaused } from "../local-worker";

export const ARCHIVE_FORMAT = 1;
export const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 12_000;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const BUCKETS = new Set(["forgecy-assets", "forgecy-sources"]);

const manifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotId: z.string().uuid(),
  createdAt: z.string().datetime(),
  parentHash: z.string().regex(/^(?:|[a-f0-9]{64})$/),
  deviceId: z.string().uuid(),
  database: z.object({ path: z.literal("database/forgecy.sqlite"), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  assets: z.array(z.object({ path: z.string().min(1).max(1024), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative().max(MAX_ASSET_BYTES) })).max(MAX_ARCHIVE_ENTRIES),
}).strict();
export type SnapshotManifest = z.infer<typeof manifestSchema>;
export type ValidatedArchive = { manifest: SnapshotManifest; entries: Record<string, Uint8Array> };

export function sha256(value: Uint8Array | string) { return createHash("sha256").update(value).digest("hex"); }
function contentHash(databaseHash: string, assets: SnapshotManifest["assets"]) {
  return sha256(JSON.stringify({ format: ARCHIVE_FORMAT, database: databaseHash, assets: [...assets].sort((a, b) => a.path.localeCompare(b.path)).map(({ path, sha256: hash, size }) => ({ path, sha256: hash, size })) }));
}
function snapshotHash(content: string, snapshotId: string, parentHash: string, deviceId: string) {
  return sha256(JSON.stringify({ format: ARCHIVE_FORMAT, snapshotId, parentHash, deviceId, contentHash: content }));
}
function safeArchivePath(path: string) {
  return !!path && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every(segment => segment && segment !== "." && segment !== "..");
}
function listAssets(root: string, base = "", output: { path: string; bytes: Buffer }[] = [], total = { value: 0 }) {
  if (!exists(root)) return output;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = base ? `${base}/${entry.name}` : entry.name;
    const full = join(root, entry.name);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error("L'archivio locale contiene un collegamento file non supportato");
    if (entry.isDirectory()) listAssets(full, path, output, total);
    else if (entry.isFile()) {
      if (!safeArchivePath(path) || stat.size > MAX_ASSET_BYTES) throw new Error("File locale fuori dai limiti dell'archivio");
      if (output.length >= MAX_ARCHIVE_ENTRIES || total.value + stat.size > MAX_UNCOMPRESSED_BYTES)
        throw new Error("Workspace oltre i limiti massimi dell'archivio");
      output.push({ path, bytes: readFileSync(full) });
      total.value += stat.size;
    }
  }
  return output;
}

/** Create a point-in-time database image, scrub machine secrets and package only workspace files. */
export async function createWorkspaceArchive(options: { parentHash?: string; deviceId?: string } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "forgecy-export-"));
  try {
    const databasePath = join(scratch, "forgecy.sqlite");
    await localDb().snapshot(databasePath);
    const image = new Database(databasePath);
    image.prepare("UPDATE social_accounts SET token_ciphertext='',token_expires_at=NULL,needs_reauth=1").run();
    image.pragma("wal_checkpoint(TRUNCATE)");
    image.close();
    const database = readFileSync(databasePath);
    const filesRoot = join(getLocalDataDirectory(), "files");
    const assets = [] as SnapshotManifest["assets"];
    const entries: Record<string, Uint8Array> = { "database/forgecy.sqlite": database };
    for (const file of listAssets(filesRoot)) {
      const archivePath = `files/${file.path}`;
      entries[archivePath] = file.bytes;
      assets.push({ path: archivePath, sha256: sha256(file.bytes), size: file.bytes.byteLength });
    }
    const databaseHash = sha256(database);
    const snapshotId = randomUUID();
    const parentHash = options.parentHash || "";
    const deviceId = options.deviceId || randomUUID();
    const manifest: SnapshotManifest = {
      format: ARCHIVE_FORMAT,
      hash: snapshotHash(contentHash(databaseHash, assets), snapshotId, parentHash, deviceId),
      contentHash: contentHash(databaseHash, assets),
      snapshotId,
      createdAt: new Date().toISOString(),
      parentHash,
      deviceId,
      database: { path: "database/forgecy.sqlite", sha256: databaseHash },
      assets: assets.sort((a, b) => a.path.localeCompare(b.path)),
    };
    entries["manifest.json"] = Buffer.from(JSON.stringify(manifest));
    const archive = Buffer.from(zipSync(entries, { level: 1 }));
    if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Archivio troppo grande per la sincronizzazione Drive");
    return { archive, manifest };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

function validateZipDirectory(buffer: Buffer) {
  const start = Math.max(0, buffer.length - 65_557);
  let end = -1;
  for (let i = buffer.length - 22; i >= start; i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("Archivio ZIP incompleto");
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  let offset = buffer.readUInt32LE(end + 16);
  if (count > MAX_ARCHIVE_ENTRIES || offset + directorySize > end) throw new Error("Archivio ZIP fuori dai limiti");
  let total = 0;
  const names = new Set<string>();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Indice ZIP non valido");
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const external = buffer.readUInt32LE(offset + 38);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error("Archivi ZIP64 non supportati");
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const mode = external >>> 16;
    if (!safeArchivePath(name) || names.has(name) || (mode & 0xf000) === 0xa000) throw new Error("Percorso ZIP non consentito");
    names.add(name);
    total += uncompressed;
    const perFileLimit = name.startsWith("files/") ? MAX_ASSET_BYTES : MAX_ARCHIVE_BYTES;
    if (total > MAX_UNCOMPRESSED_BYTES || uncompressed > perFileLimit) throw new Error("Archivio decompresso troppo grande");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== buffer.readUInt32LE(end + 16) + directorySize) throw new Error("Indice ZIP non coerente");
}

export function validateWorkspaceArchive(input: Uint8Array): ValidatedArchive {
  const buffer = Buffer.from(input);
  if (!buffer.byteLength || buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Archivio non valido o troppo grande");
  validateZipDirectory(buffer);
  const unzipped = unzipSync(buffer);
  const entries: Record<string, Uint8Array> = Object.create(null);
  for (const [path, content] of Object.entries(unzipped)) {
    if (!safeArchivePath(path) || !content.byteLength) throw new Error("Voce ZIP vuota o non valida");
    entries[path] = content;
  }
  const rawManifest = entries["manifest.json"];
  const database = entries["database/forgecy.sqlite"];
  if (!rawManifest || !database) throw new Error("L'archivio Forgecy è incompleto");
  const manifest = manifestSchema.parse(JSON.parse(Buffer.from(rawManifest).toString("utf8")));
  if (sha256(database) !== manifest.database.sha256) throw new Error("Hash del database non corrispondente");
  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    if (!safeArchivePath(asset.path) || !asset.path.startsWith("files/") || seen.has(asset.path)) throw new Error("Manifest degli allegati non valido");
    seen.add(asset.path);
    const bytes = entries[asset.path];
    if (!bytes || bytes.byteLength !== asset.size || sha256(bytes) !== asset.sha256) throw new Error("Hash di un allegato non corrispondente");
  }
  const declared = new Set(["manifest.json", "database/forgecy.sqlite", ...manifest.assets.map(asset => asset.path)]);
  if (Object.keys(entries).some(path => !declared.has(path)) || declared.size !== Object.keys(entries).length) throw new Error("L'archivio contiene file non dichiarati");
  const actualContentHash = contentHash(manifest.database.sha256, manifest.assets);
  if (actualContentHash !== manifest.contentHash || snapshotHash(actualContentHash, manifest.snapshotId, manifest.parentHash, manifest.deviceId) !== manifest.hash) throw new Error("Hash dello snapshot non corrispondente");
  const scratch = mkdtempSync(join(tmpdir(), "forgecy-verify-"));
  const databasePath = join(scratch, "check.sqlite");
  try {
    writeFileSync(databasePath, database, { mode: 0o600 });
    const check = new Database(databasePath, { readonly: true });
    try {
      if (check.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Il database nell'archivio è danneggiato");
      if ((check.pragma("foreign_key_check") as unknown[]).length) throw new Error("Il database contiene relazioni non valide");
    } finally { check.close(); }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  return { manifest, entries };
}

let restoreQueue = Promise.resolve();

/** Serialize restores so separate requests cannot swap the workspace concurrently. */
export function restoreWorkspaceArchive(input: Uint8Array) {
  const task = restoreQueue.then(() => restoreWorkspaceArchiveUnlocked(input));
  restoreQueue = task.then(() => undefined, () => undefined);
  return task;
}

/** Restore only after full validation; retain a local pre-restore copy for recovery. */
async function restoreWorkspaceArchiveUnlocked(input: Uint8Array) {
  const validated = validateWorkspaceArchive(input);
  const root = getLocalDataDirectory();
  const stage = join(root, `restore-${randomUUID()}`);
  const newDb = join(stage, "forgecy.sqlite");
  const newFiles = join(stage, "files");
  mkdirSync(newFiles, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(newDb, validated.entries["database/forgecy.sqlite"], { mode: 0o600 });
    for (const asset of validated.manifest.assets) {
      const relative = asset.path.slice("files/".length);
      const bucket = relative.split("/")[0];
      if (!BUCKETS.has(bucket)) throw new Error("Archivio asset non valido");
      const target = resolve(newFiles, relative);
      if (!target.startsWith(newFiles + sep)) throw new Error("Percorso asset non consentito");
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, validated.entries[asset.path], { mode: 0o600, flag: "wx" });
    }
    const test = new Database(newDb, { readonly: true }); test.close();

    const backupDirectory = join(root, "pre-restore"); mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const backupName = `forgecy-${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
    const currentDb = join(root, "forgecy.sqlite");
    const currentFiles = join(root, "files");
    const backupDb = join(backupDirectory, backupName);
    const backupFiles = join(backupDirectory, backupName.replace(/\.sqlite$/, "-files"));
    return await withLocalWorkerPaused(async () => {
      const old = globalThis.__forgecyLocalDb;
      old?.pragma("wal_checkpoint(TRUNCATE)");
      old?.close(); delete globalThis.__forgecyLocalDb;
      for (const suffix of ["-wal", "-shm"]) {
        try { unlinkSync(currentDb + suffix); } catch { /* SQLite may already have removed this sidecar. */ }
      }
      let movedDb = false, movedFiles = false, installedDb = false, installedFiles = false;
      try {
        if (exists(currentDb)) { renameSync(currentDb, backupDb); movedDb = true; }
        if (exists(currentFiles)) { renameSync(currentFiles, backupFiles); movedFiles = true; }
        renameSync(newDb, currentDb); installedDb = true;
        renameSync(newFiles, currentFiles); installedFiles = true;
        const restored = new Database(currentDb);
        restored.pragma("foreign_keys = ON"); restored.pragma("journal_mode = WAL"); restored.pragma("busy_timeout = 5000");
        restored.pragma("synchronous = FULL");
        try { chmodSync(currentDb, 0o600); } catch { /* Windows uses the private app data folder ACL. */ }
        globalThis.__forgecyLocalDb = restored;
        return { hash: validated.manifest.hash, backup: movedDb ? backupDb : null };
      } catch (error) {
        if (installedFiles && exists(currentFiles)) rmSync(currentFiles, { recursive: true, force: true });
        if (installedDb && exists(currentDb)) rmSync(currentDb, { force: true });
        if (movedFiles) renameSync(backupFiles, currentFiles);
        if (movedDb) renameSync(backupDb, currentDb);
        if (old?.open) globalThis.__forgecyLocalDb = old;
        throw error;
      }
    });
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

import { existsSync as exists } from "node:fs";
