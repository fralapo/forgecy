import { Entry } from "@napi-rs/keyring";
import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiFailure } from "../http";
import { getLocalDataDirectory, localDb } from "../local-db";
import { createWorkspaceArchive, restoreWorkspaceArchive, validateWorkspaceArchive, type SnapshotManifest } from "./archive";
import { saveLocalConflictCopy } from "./conflict-backup";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const CREDENTIAL_SERVICE = "Forgecy Google Drive";
const CREDENTIAL_ACCOUNT = "oauth-refresh-token";
const FLOW_TTL = 5 * 60_000;

type Tokens = { clientId: string; refreshToken: string; accessToken?: string; expiresAt?: number };
type SyncState = { deviceId: string; folderId?: string; lastSyncedHash?: string; lastSyncedContentHash?: string; lastSyncedAt?: string };
export type DriveFile = { id: string; name: string; size?: string; appProperties?: Record<string, string> };
type Flow = { status: "pending" | "connected" | "error"; message?: string; expiresAt: number; server?: ReturnType<typeof createServer> };
const flows = new Map<string, Flow>();
let syncInProgress = false;

function dataDirectory() {
  const path = getLocalDataDirectory(); mkdirSync(path, { recursive: true, mode: 0o700 });
  try { chmodSync(path, 0o700); } catch { /* The app data directory inherits the current user's ACL on Windows. */ }
  return path;
}
function statePath() { return join(dataDirectory(), "drive-sync.json"); }
function tokenFilePath() { return join(dataDirectory(), "google-drive-oauth.json"); }
function keyringEntry() { return new Entry(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT); }

async function readTokens(): Promise<Tokens | null> {
  try {
    const secret = keyringEntry().getPassword();
    if (secret) return JSON.parse(secret) as Tokens;
  } catch { /* Keychain unavailable; use the owner-only app data fallback below. */ }
  try { return JSON.parse(readFileSync(tokenFilePath(), "utf8")) as Tokens; } catch { return null; }
}
async function writeTokens(tokens: Tokens) {
  let stored = false;
  try { keyringEntry().setPassword(JSON.stringify(tokens)); stored = true; } catch { /* Headless Linux may not have a Secret Service. */ }
  if (stored) {
    try { unlinkSync(tokenFilePath()); } catch { /* No fallback file to remove. */ }
    return;
  }
  writeFileSync(tokenFilePath(), JSON.stringify(tokens), { mode: 0o600 });
  try { chmodSync(tokenFilePath(), 0o600); } catch { /* Windows uses the app data directory ACL. */ }
}
async function removeTokens() {
  try { keyringEntry().deletePassword(); } catch { /* No keyring entry. */ }
  try { unlinkSync(tokenFilePath()); } catch { /* No fallback file. */ }
}
function readState(): SyncState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as Partial<SyncState>;
    if (parsed.deviceId && zUuid(parsed.deviceId)) return { deviceId: parsed.deviceId, folderId: parsed.folderId, lastSyncedHash: parsed.lastSyncedHash, lastSyncedContentHash: parsed.lastSyncedContentHash, lastSyncedAt: parsed.lastSyncedAt };
  } catch { /* First run or an interrupted metadata write; create fresh local state. */ }
  const state = { deviceId: randomUUID() };
  saveState(state);
  return state;
}
function zUuid(value: string) { return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value); }
function saveState(state: SyncState) {
  const target = statePath(), temp = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  try { chmodSync(temp, 0o600); } catch { /* Windows uses inherited ACLs. */ }
  renameSync(temp, target);
}

async function exchangeCode(form: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof result.access_token !== "string") throw new Error("Google non ha completato l'autorizzazione");
  return result;
}

export function googleDriveConfigured() { return Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID?.endsWith(".apps.googleusercontent.com")); }

export async function beginGoogleDriveOAuth() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  if (!clientId || !clientId.endsWith(".apps.googleusercontent.com")) throw new ApiFailure(503, "Imposta GOOGLE_DRIVE_CLIENT_ID nel file .env.local per collegare Google Drive");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const flowId = randomUUID();
  const flow: Flow = { status: "pending", expiresAt: Date.now() + FLOW_TTL };
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const callback = new URL(request.url || "/", "http://127.0.0.1");
        if (request.method !== "GET" || callback.pathname !== "/") throw new Error("Callback OAuth non valido");
        const returnedState = callback.searchParams.get("state") || "";
        if (returnedState.length !== state.length || !Buffer.from(returnedState).equals(Buffer.from(state))) throw new Error("Verifica OAuth non riuscita");
        const error = callback.searchParams.get("error");
        if (error || !callback.searchParams.get("code")) throw new Error(error === "access_denied" ? "Autorizzazione Google annullata" : "Risposta OAuth incompleta");
        const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const result = await exchangeCode(new URLSearchParams({ client_id: clientId, code: callback.searchParams.get("code")!, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }));
        const previous = await readTokens();
        if (typeof result.refresh_token !== "string" && !previous?.refreshToken) throw new Error("Google non ha fornito un token di aggiornamento; ripeti il collegamento con accesso offline");
        await writeTokens({ clientId, refreshToken: String(result.refresh_token || previous!.refreshToken), accessToken: String(result.access_token), expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 });
        flow.status = "connected"; flow.message = "Google Drive collegato";
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
        response.end("<!doctype html><meta charset=utf-8><title>Forgecy</title><style>body{font:16px system-ui;max-width:36rem;margin:12vh auto;padding:0 1.5rem;color:#234b38}h1{font-size:1.5rem}p{line-height:1.6}</style><h1>Google Drive collegato a Forgecy</h1><p>Puoi tornare all'app. Questa finestra può essere chiusa.</p>");
      } catch (error) {
        flow.status = "error"; flow.message = error instanceof Error ? error.message : "Autorizzazione Google non riuscita";
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
        response.end("<!doctype html><meta charset=utf-8><title>Forgecy</title><style>body{font:16px system-ui;max-width:36rem;margin:12vh auto;padding:0 1.5rem;color:#234b38}</style><h1>Collegamento non riuscito</h1><p>Torna a Forgecy e riprova. Puoi chiudere questa finestra.</p>");
      } finally { server.close(); }
    })();
  });
  flows.set(flowId, flow);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") { flow.status = "error"; flow.message = "Callback locale non disponibile"; server.close(); return; }
    const redirectUri = `http://127.0.0.1:${address.port}`;
    const authUrl = new URL(GOOGLE_AUTH);
    authUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", include_granted_scopes: "true", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    flow.message = authUrl.toString();
  });
  flow.server = server;
  const timeout = setTimeout(() => { if (flow.status === "pending") { flow.status = "error"; flow.message = "Collegamento scaduto"; server.close(); } }, FLOW_TTL);
  timeout.unref?.();
  // Wait for the ephemeral loopback listener before returning the auth URL.
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve()); server.once("error", reject);
  });
  return { flowId, authorizationUrl: flow.message! };
}

export function googleDriveFlow(flowId: string) {
  const flow = flows.get(flowId);
  if (!flow || flow.expiresAt < Date.now()) return { status: "expired" as const };
  return { status: flow.status, message: flow.status === "error" ? flow.message : undefined };
}

export async function googleDriveStatus() {
  const tokens = await readTokens();
  const state = readState();
  return { configured: googleDriveConfigured(), connected: Boolean(tokens?.refreshToken), folderId: state.folderId || null, lastSyncedAt: state.lastSyncedAt || null, hasPreviousSync: Boolean(state.lastSyncedHash) };
}

async function validTokens(forceRefresh = false): Promise<Tokens> {
  const tokens = await readTokens();
  if (!tokens?.refreshToken) throw new ApiFailure(409, "Collega Google Drive prima di sincronizzare");
  if (tokens.clientId !== process.env.GOOGLE_DRIVE_CLIENT_ID) throw new ApiFailure(409, "GOOGLE_DRIVE_CLIENT_ID è cambiato: ricollega Google Drive");
  if (!forceRefresh && tokens.accessToken && (tokens.expiresAt || 0) > Date.now() + 60_000) return tokens;
  const form = new URLSearchParams({ client_id: tokens.clientId, refresh_token: tokens.refreshToken, grant_type: "refresh_token" });
  const response = await fetch(GOOGLE_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof result.access_token !== "string") {
    if (result.error === "invalid_grant") throw new ApiFailure(409, "Autorizzazione Google scaduta o revocata. Ricollega Drive nelle impostazioni.");
    throw new ApiFailure(502, "Impossibile rinnovare l'autorizzazione Google Drive");
  }
  const refreshed = { ...tokens, accessToken: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 };
  await writeTokens(refreshed);
  return refreshed;
}

const DRIVE_READ_RETRIES = 3;
const DRIVE_RETRY_BASE_MS = 350;
const DRIVE_RETRY_MAX_MS = 8_000;

function retryDelay(response: { headers: Headers } | null, attempt: number) {
  const retryAfter = response?.headers.get("retry-after");
  const seconds = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : NaN;
  const requested = Number.isFinite(seconds) ? seconds * 1000 : DRIVE_RETRY_BASE_MS * 2 ** attempt;
  return Math.min(DRIVE_RETRY_MAX_MS, Math.max(0, requested));
}

export async function withDriveReadRetries<T extends { status: number; headers: Headers }>(request: () => Promise<T>, isAborted: () => boolean = () => false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let response: T | null = null;
    try {
      response = await request();
      if ((response.status !== 429 && response.status < 500) || attempt >= DRIVE_READ_RETRIES) return response;
    } catch (error) {
      if (isAborted() || attempt >= DRIVE_READ_RETRIES) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, retryDelay(response, attempt)));
  }
}

async function driveFetch(path: string, init: RequestInit = {}, retryAuth = true): Promise<Response> {
  const tokens = await validTokens();
  const url = path.startsWith("https://") ? new URL(path) : new URL(path, DRIVE_API);
  if (url.hostname !== "www.googleapis.com" || (path.startsWith("https://") && !url.pathname.startsWith("/upload/drive/v3/")))
    throw new ApiFailure(502, "Google Drive ha restituito un endpoint di caricamento non valido");
  const request = () => fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${tokens.accessToken}`, ...init.headers },
      signal: init.signal || AbortSignal.timeout(30_000), cache: "no-store",
    });
  const isRead = !init.method || init.method.toUpperCase() === "GET";
  let response: Response;
  try {
    response = isRead
      ? await withDriveReadRetries(request, () => Boolean(init.signal?.aborted))
      : await request();
  } catch {
    throw new ApiFailure(503, "Google Drive non è raggiungibile. Controlla la connessione e riprova.");
  }
  if (response.status === 401 && retryAuth) {
    await validTokens(true);
    return driveFetch(path, init, false);
  }
  return response;
}

async function driveJson(path: string, init?: RequestInit) {
  const response = await driveFetch(path, init);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new ApiFailure(409, "Google Drive ha rifiutato l'accesso. Ricollega l'account o verifica l'API Drive.");
    if (response.status === 429) throw new ApiFailure(503, "Limite temporaneo Google Drive raggiunto; riprova tra poco.");
    console.error("[drive] HTTP", response.status);
    throw new ApiFailure(502, "Sincronizzazione Google Drive non riuscita");
  }
  return response.json();
}

async function getOrCreateFolder(state: SyncState) {
  if (state.folderId) {
    const check = await driveFetch(`/files/${encodeURIComponent(state.folderId)}?fields=id,mimeType,trashed`);
    if (check.ok) {
      const data = await check.json() as { id: string; mimeType: string; trashed?: boolean };
      if (!data.trashed && data.mimeType === "application/vnd.google-apps.folder") return data.id;
    }
    state.folderId = undefined;
  }
  const q = encodeURIComponent("name='Forgecy' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const existing = await driveJson(`/files?q=${q}&spaces=drive&pageSize=100&fields=files(id,name,createdTime),nextPageToken`) as { files?: { id: string; name: string }[] };
  if (existing.files?.length) { state.folderId = existing.files[0].id; return state.folderId; }
  const created = await driveJson("/files?fields=id,name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Forgecy", mimeType: "application/vnd.google-apps.folder", appProperties: { forgecy: "root" } }) }) as { id: string };
  state.folderId = created.id;
  saveState(state);
  return created.id;
}

async function listSnapshots(folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ q: `'${folderId}' in parents and trashed=false`, spaces: "drive", pageSize: "1000", fields: "nextPageToken,files(id,name,size,appProperties,mimeType)" });
    if (pageToken) query.set("pageToken", pageToken);
    const result = await driveJson(`/files?${query}`) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(result.files || []).filter(file => file.appProperties?.forgecy === "snapshot" && /^[a-f0-9]{64}$/.test(file.appProperties?.hash || "")));
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  return files;
}

export function branchHeads(files: DriveFile[]) {
  const parents = new Set(files.map(file => file.appProperties?.parentHash).filter((value): value is string => Boolean(value)));
  return files.filter(file => !parents.has(file.appProperties?.hash || ""));
}

async function uploadSnapshot(folderId: string, archive: Buffer, manifest: SnapshotManifest) {
  const timestamp = manifest.createdAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const metadata = {
    name: `snapshot-${timestamp}-${manifest.hash.slice(0, 12)}.forgecy.zip`,
    mimeType: "application/zip",
    parents: [folderId],
    appProperties: { forgecy: "snapshot", format: String(manifest.format), hash: manifest.hash, contentHash: manifest.contentHash, parentHash: manifest.parentHash || "", deviceId: manifest.deviceId },
  };
  const start = await driveFetch(`${DRIVE_UPLOAD}?uploadType=resumable&fields=id,name,size,appProperties`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": "application/zip", "X-Upload-Content-Length": String(archive.byteLength) },
    body: JSON.stringify(metadata), signal: AbortSignal.timeout(30_000),
  });
  if (!start.ok) { console.error("[drive upload init] HTTP", start.status); throw new ApiFailure(502, "Impossibile avviare il caricamento dello snapshot"); }
  const session = start.headers.get("location");
  if (!session) throw new ApiFailure(502, "Google Drive non ha creato la sessione di caricamento");
  const finish = await driveFetch(session, { method: "PUT", headers: { "Content-Type": "application/zip", "Content-Length": String(archive.byteLength) }, body: new Uint8Array(archive), signal: AbortSignal.timeout(180_000) });
  if (!finish.ok) { console.error("[drive upload] HTTP", finish.status); throw new ApiFailure(502, "Caricamento Drive non completato; riprova la sincronizzazione"); }
  return finish.json() as Promise<DriveFile>;
}

export async function readBoundedResponseBody(response: Response, maxBytes = 250 * 1024 * 1024) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new ApiFailure(413, "Snapshot Drive troppo grande");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiFailure(413, "Snapshot Drive troppo grande");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function downloadSnapshot(file: DriveFile) {
  const response = await driveFetch(`/files/${encodeURIComponent(file.id)}?alt=media`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new ApiFailure(502, "Impossibile scaricare lo snapshot da Google Drive");
  const archive = await readBoundedResponseBody(response);
  const validated = validateWorkspaceArchive(archive);
  if (validated.manifest.hash !== file.appProperties?.hash || validated.manifest.contentHash !== file.appProperties?.contentHash || validated.manifest.parentHash !== (file.appProperties?.parentHash || "")) throw new ApiFailure(409, "Lo snapshot Drive non coincide con i metadati del ramo");
  return { archive, manifest: validated.manifest };
}

function isWorkspaceEmpty() {
  const count = Number((localDb().connection.prepare("SELECT count(*) n FROM clients").get() as { n?: number } | undefined)?.n || 0);
  const filesRoot = join(getLocalDataDirectory(), "files");
  let hasFiles = false;
  try { hasFiles = readdirSync(filesRoot).length > 0; } catch { /* New workspace has no files directory. */ }
  return count === 0 && !hasFiles;
}

export type SyncOutcome =
  | { status: "uploaded" | "downloaded" | "in-sync"; hash: string; message: string }
  | { status: "conflict"; localHash: string; lastSyncedHash: string | null; branches: { id: string; name: string; hash: string; parentHash: string }[]; message: string };

export async function syncGoogleDrive(): Promise<SyncOutcome> {
  if (syncInProgress) throw new ApiFailure(409, "Una sincronizzazione è già in corso");
  syncInProgress = true;
  try {
    const state = readState();
    const folderId = await getOrCreateFolder(state);
    saveState(state);
    const local = await createWorkspaceArchive({ parentHash: state.lastSyncedHash || "", deviceId: state.deviceId });
    const files = await listSnapshots(folderId);
    const leaves = branchHeads(files);
    const conflict = (): SyncOutcome => ({
      status: "conflict", localHash: local.manifest.hash, lastSyncedHash: state.lastSyncedHash || null,
      branches: leaves.map(file => ({ id: file.id, name: file.name, hash: file.appProperties!.hash, parentHash: file.appProperties!.parentHash || "" })),
      message: "Le copie sono cambiate su dispositivi diversi. Scegli quale copia vuoi aprire; entrambe restano conservate.",
    });
    if (!files.length) {
      const uploaded = await uploadSnapshot(folderId, local.archive, local.manifest);
      state.lastSyncedHash = local.manifest.hash; state.lastSyncedContentHash = local.manifest.contentHash; state.lastSyncedAt = new Date().toISOString(); saveState(state);
      return { status: "uploaded", hash: uploaded.appProperties?.hash || local.manifest.hash, message: "Primo snapshot salvato nella cartella Forgecy di Drive." };
    }
    // A user may intentionally keep several branches. Continue on the branch
    // this device selected instead of forcing the same conflict on every run.
    const selectedHead = state.lastSyncedHash ? leaves.find(file => file.appProperties?.hash === state.lastSyncedHash) : undefined;
    if (leaves.length > 1 && !selectedHead) return conflict();
    if (!leaves.length) return conflict();
    const head = selectedHead || leaves[0];
    const headHash = head.appProperties!.hash;
    if (!state.lastSyncedHash) {
      if (!isWorkspaceEmpty()) return conflict();
      const remote = await downloadSnapshot(head);
      await restoreWorkspaceArchive(remote.archive);
      state.lastSyncedHash = remote.manifest.hash; state.lastSyncedContentHash = remote.manifest.contentHash; state.lastSyncedAt = new Date().toISOString(); saveState(state);
      return { status: "downloaded", hash: remote.manifest.hash, message: "Workspace scaricato da Drive su questo computer." };
    }
    if (headHash === state.lastSyncedHash) {
      if (local.manifest.contentHash === state.lastSyncedContentHash) {
        state.lastSyncedAt = new Date().toISOString(); saveState(state);
        return { status: "in-sync", hash: headHash, message: "Workspace già sincronizzato." };
      }
      const next = await createWorkspaceArchive({ parentHash: headHash, deviceId: state.deviceId });
      const uploaded = await uploadSnapshot(folderId, next.archive, next.manifest);
      state.lastSyncedHash = next.manifest.hash; state.lastSyncedContentHash = next.manifest.contentHash; state.lastSyncedAt = new Date().toISOString(); saveState(state);
      return { status: "uploaded", hash: uploaded.appProperties?.hash || next.manifest.hash, message: "Nuovo snapshot caricato su Drive." };
    }
    if (local.manifest.contentHash === state.lastSyncedContentHash) {
      const remote = await downloadSnapshot(head);
      await restoreWorkspaceArchive(remote.archive);
      state.lastSyncedHash = remote.manifest.hash; state.lastSyncedContentHash = remote.manifest.contentHash; state.lastSyncedAt = new Date().toISOString(); saveState(state);
      return { status: "downloaded", hash: remote.manifest.hash, message: "Modifiche scaricate da Drive su questo computer." };
    }
    return conflict();
  } finally { syncInProgress = false; }
}

export async function resolveDriveConflict(choice: "local" | "remote", remoteFileId?: string) {
  const state = readState();
  const folderId = await getOrCreateFolder(state);
  const files = await listSnapshots(folderId);
  const leaves = branchHeads(files);
  if (choice === "local") {
    const local = await createWorkspaceArchive({ parentHash: state.lastSyncedHash || "", deviceId: state.deviceId });
    const uploaded = await uploadSnapshot(folderId, local.archive, local.manifest);
    state.lastSyncedHash = local.manifest.hash; state.lastSyncedContentHash = local.manifest.contentHash; state.lastSyncedAt = new Date().toISOString(); saveState(state);
    return { status: "uploaded" as const, hash: uploaded.appProperties?.hash || local.manifest.hash, message: "La copia locale è stata salvata come ramo autonomo su Drive. Le altre copie sono rimaste intatte." };
  }
  const chosen = leaves.find(file => file.id === remoteFileId);
  if (!chosen) throw new ApiFailure(404, "Copia Drive non trovata o non più disponibile");
  const remote = await downloadSnapshot(chosen);
  const local = await createWorkspaceArchive({ parentHash: state.lastSyncedHash || "", deviceId: state.deviceId });
  const localCopy = saveLocalConflictCopy(dataDirectory(), local.archive, local.manifest.createdAt, local.manifest.hash);
  await restoreWorkspaceArchive(remote.archive);
  state.lastSyncedHash = remote.manifest.hash; state.lastSyncedContentHash = remote.manifest.contentHash; state.lastSyncedAt = new Date().toISOString(); saveState(state);
  return { status: "downloaded" as const, hash: remote.manifest.hash, localConflictCopy: localCopy, message: "Copia Drive aperta. La versione locale precedente è conservata nella cartella conflitti di Forgecy." };
}

export async function disconnectGoogleDrive() {
  const tokens = await readTokens();
  if (tokens?.refreshToken) {
    try { await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tokens.refreshToken }), signal: AbortSignal.timeout(10_000) }); } catch { /* Local credentials are cleared even if Google is unreachable. */ }
  }
  await removeTokens();
  const state = readState(); state.folderId = undefined; state.lastSyncedHash = undefined; state.lastSyncedContentHash = undefined; state.lastSyncedAt = undefined; saveState(state);
}
