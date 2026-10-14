import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, rename, rm, statfs, writeFile } from "node:fs/promises";
import { homedir, totalmem, freemem, cpus, platform, arch } from "node:os";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import { getLocalDataDirectory } from "./local-db";
import { ApiFailure } from "./http";
import type { OcrImage, OcrResult } from "./openrouter-document-ocr";

const execFile = promisify(execFileCb);
const REPO = "https://api.github.com/repos/PaddlePaddle/PaddleOCR/releases/latest";
const PADDLE_CPU_INDEX = "https://www.paddlepaddle.org.cn/packages/stable/cpu/";
const PADDLE_VERSION = "3.2.1";
const activeVersions = new Map<string, number>();
const jobs = new Map<string, LocalOcrJob>();
let releaseCache: { at: number; version: string | null } | null = null;

export type OcrProvider = "auto" | "openrouter" | "local";
export type OcrHardware = {
  platform: string; architecture: string; memoryGb: number; freeMemoryGb: number; cores: number;
  diskFreeGb: number | null; uvPath: string | null; supported: boolean; installReady: boolean; recommendation: "local" | "api";
  reasons: string[];
};
export type LocalOcrJob = { id: string; status: "installing" | "ready" | "failed"; stage: string; version: string; error?: string; startedAt: string; finishedAt?: string };

function root() { return join(getLocalDataDirectory(), "ocr", "paddleocr-vl"); }
function safeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(value.trim());
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}
export function stablePaddleRelease(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const release = payload as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
  return release.draft === false && release.prerelease === false ? safeVersion(release.tag_name) : null;
}
function pythonFor(version: string) { return join(root(), version, ".venv", platform() === "win32" ? "Scripts" : "bin", platform() === "win32" ? "python.exe" : "python"); }
function envFor(version: string): NodeJS.ProcessEnv {
  return { ...process.env, PADDLE_PDX_CACHE_HOME: join(root(), version, "models"), HF_HOME: join(root(), "hf-cache"), PYTHONUNBUFFERED: "1" };
}
async function command(file: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 30 * 60_000) {
  try { await execFile(file, args, { env, timeout, maxBuffer: 5_000_000, windowsHide: true }); }
  catch (cause) {
    const message = cause instanceof Error ? cause.message : "comando non riuscito";
    throw new Error(`${file} non è riuscito: ${message.slice(0, 600)}`);
  }
}

export async function detectOcrHardware(): Promise<OcrHardware> {
  let uvPath: string | null = null;
  const uvSearchPath = platform() === "win32"
    ? [process.env.PATH || "", join(homedir(), ".local", "bin"), join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "uv")].join(platform() === "win32" ? ";" : ":")
    : [process.env.PATH || "", join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].join(":");
  try { const result = await execFile(platform() === "win32" ? "where" : "which", ["uv"], { env: { ...process.env, PATH: uvSearchPath }, timeout: 1500 }); uvPath = result.stdout.trim().split(/\r?\n/u)[0] || null; } catch { /* uv is an optional local runtime */ }
  let diskFreeGb: number | null = null;
  try { const fs = await statfs(getLocalDataDirectory()); diskFreeGb = fs.bavail * fs.bsize / 1024 ** 3; } catch { /* data directory may not exist yet */ }
  const memoryGb = totalmem() / 1024 ** 3;
  const supported = (platform() === "darwin" && arch() === "arm64") || ((platform() === "linux" || platform() === "win32") && arch() === "x64");
  const reasons: string[] = [];
  if (!supported) reasons.push("Questa combinazione di sistema e processore non è verificata per il parser locale.");
  if (memoryGb < 12) reasons.push("La memoria disponibile è sotto i 12 GB consigliati per il modello documentale.");
  if (diskFreeGb !== null && diskFreeGb < 8) reasons.push("Servono almeno 8 GB liberi per ambiente Python, motori e modelli.");
  if (diskFreeGb === null) reasons.push("Non riesco a verificare lo spazio libero: l'installazione locale resta disabilitata fino al controllo.");
  if (!uvPath) reasons.push("Installa uv per creare un ambiente Python isolato, senza modificare quello di sistema.");
  const canRunLocally = supported && memoryGb >= 12;
  const installReady = canRunLocally && Boolean(uvPath) && diskFreeGb !== null && diskFreeGb >= 8;
  const recommendation = canRunLocally ? "local" : "api";
  return { platform: platform(), architecture: arch(), memoryGb: round(memoryGb), freeMemoryGb: round(freemem() / 1024 ** 3), cores: cpus().length, diskFreeGb: diskFreeGb === null ? null : round(diskFreeGb), uvPath, supported, installReady, recommendation, reasons };
}
function round(value: number) { return Math.round(value * 10) / 10; }
export function selectOcrProvider(preference: OcrProvider, installed: boolean, recommendation: "local" | "api"): "local" | "openrouter" {
  if (preference === "local") return "local";
  if (preference === "openrouter") return "openrouter";
  return installed && recommendation === "local" ? "local" : "openrouter";
}

export async function latestPaddleOcrVersion(fetcher: typeof fetch = fetch): Promise<string | null> {
  if (releaseCache && Date.now() - releaseCache.at < 30 * 60_000) return releaseCache.version;
  try {
    const response = await fetcher(REPO, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Forgecy-local-ocr-updater" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) return releaseCache?.version ?? null;
    const payload = await response.json();
    const version = stablePaddleRelease(payload);
    releaseCache = { at: Date.now(), version };
    return version;
  } catch { return releaseCache?.version ?? null; }
}

async function currentVersion(): Promise<string | null> {
  try {
    const pointer = JSON.parse(await readFile(join(root(), "active.json"), "utf8")) as { version?: unknown };
    const version = safeVersion(pointer.version);
    if (!version) return null;
    await access(pythonFor(version));
    return version;
  } catch { return null; }
}
function jobFor(version: string): LocalOcrJob | null {
  return [...jobs.values()].filter(job => job.version === version).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}

export async function localOcrStatus() {
  const [hardware, installedVersion, latestVersion] = await Promise.all([detectOcrHardware(), currentVersion(), latestPaddleOcrVersion()]);
  const operation = [...jobs.values()].filter(job => job.status === "installing").sort((a,b) => b.startedAt.localeCompare(a.startedAt))[0]
    ?? (latestVersion ? jobFor(latestVersion) : null)
    ?? (installedVersion ? jobFor(installedVersion) : [...jobs.values()].sort((a,b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null);
  return { hardware, installedVersion, latestVersion, updateAvailable: Boolean(installedVersion && latestVersion && latestVersion !== installedVersion), operation };
}

async function runSetup(version: string, job: LocalOcrJob, uvPath: string) {
  const base = root(); const stage = join(base, `.staging-${version}-${job.id}`); const final = join(base, version);
  let installedVersionDirectory = false;
  let activePointerCommitted = false;
  const update = (stageName: string) => { job.stage = stageName; };
  try {
    await mkdir(base, { recursive: true, mode: 0o700 });
    const { readdir } = await import("node:fs/promises");
    for (const name of await readdir(base).catch(() => []))
      if (name.startsWith(".staging-") && name !== stage.split(/[\\/]/u).pop()) await rm(join(base, name), { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
    update("Installazione di Python 3.12 isolato");
    const env = { ...process.env, UV_PYTHON_INSTALL_DIR: join(base, "python"), UV_CACHE_DIR: join(base, "uv-cache", version) };
    await command(uvPath, ["python", "install", "3.12"], env);
    await command(uvPath, ["venv", "--python", "3.12", "--managed-python", stage + "/.venv"], env);
    const python = join(stage, ".venv", platform() === "win32" ? "Scripts/python.exe" : "bin/python");
    update("Installazione PaddlePaddle CPU e parser PaddleOCR");
    const stageModelEnv = { ...env, PADDLE_PDX_CACHE_HOME: join(stage, "models"), HF_HOME: join(base, "hf-cache") };
    if (platform() === "darwin" && arch() === "arm64") await command(uvPath, ["pip", "install", "--python", python, `paddlepaddle==${PADDLE_VERSION}`, "--index-url", PADDLE_CPU_INDEX], stageModelEnv);
    else await command(uvPath, ["pip", "install", "--python", python, `paddlepaddle==${PADDLE_VERSION}`], stageModelEnv);
    await command(uvPath, ["pip", "install", "--python", python, `paddleocr[doc-parser]==${version}`], stageModelEnv);
    update("Scaricamento del modello e verifica OCR locale");
    await command(python, [join(process.cwd(), "python", "forgecy_paddleocr.py"), "--self-test"], stageModelEnv);
    await rename(stage, final);
    installedVersionDirectory = true;
    const pointerTemp = join(base, `.active-${job.id}.json`);
    await writeFile(pointerTemp, JSON.stringify({ version, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    await rename(pointerTemp, join(base, "active.json"));
    activePointerCommitted = true;
    job.status = "ready"; job.stage = "Parser locale pronto e verificato"; job.finishedAt = new Date().toISOString();
    await pruneOldVersions(version);
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    if (installedVersionDirectory && !activePointerCommitted) await rm(final, { recursive: true, force: true }).catch(() => undefined);
    job.status = "failed"; job.stage = "Installazione non riuscita"; job.error = error instanceof Error ? error.message.slice(0, 700) : "Errore durante l'installazione"; job.finishedAt = new Date().toISOString();
  }
}

async function pruneOldVersions(active: string) {
  const base = root();
  const { readdir } = await import("node:fs/promises");
  for (const name of await readdir(base).catch(() => [])) {
    const version = safeVersion(name);
    if (!version || version === active || (activeVersions.get(version) ?? 0) > 0) continue;
    await rm(join(base, name), { recursive: true, force: true }).catch(() => undefined);
    await rm(join(base, "uv-cache", name), { recursive: true, force: true }).catch(() => undefined);
  }
}

export function startLocalOcrInstall(version?: string | null): LocalOcrJob {
  const selected = safeVersion(version) ?? "3.6.0";
  const inProgress = jobFor(selected);
  if (inProgress?.status === "installing") return inProgress;
  const id = randomUUID();
  const job: LocalOcrJob = { id, status: "installing", stage: "Preparazione", version: selected, startedAt: new Date().toISOString() };
  jobs.set(id, job);
  void detectOcrHardware().then(hw => {
    if (!hw.uvPath) throw new Error("uv non è installato. Installa uv dal sito ufficiale https://docs.astral.sh/uv/getting-started/installation/ e riprova.");
    if (!hw.supported || hw.memoryGb < 12 || !hw.uvPath || !hw.installReady) throw new Error("Per installare il parser servono un sistema supportato, almeno 12 GB di RAM, uv e 8 GB liberi. Usa OpenRouter oppure libera spazio.");
    return runSetup(selected, job, hw.uvPath);
  }).catch(error => { job.status="failed"; job.stage="Installazione non avviata"; job.error=error instanceof Error?error.message:"Installazione non riuscita"; job.finishedAt=new Date().toISOString(); });
  return job;
}

export function maybeStartAutomaticUpdate(status: Awaited<ReturnType<typeof localOcrStatus>>, enabled: boolean) {
  if (enabled && status.installedVersion && status.updateAvailable && !jobFor(status.latestVersion || ""))
    return startLocalOcrInstall(status.latestVersion);
  return status.operation;
}

export async function ocrDocumentLocally(options: { bytes: Uint8Array; mime: string; name: string }): Promise<OcrResult> {
  const version = await currentVersion();
  if (!version) throw new ApiFailure(409, "Il parser locale non è installato. Installa PaddleOCR dalle impostazioni o scegli OpenRouter.");
  const ext = options.mime === "application/pdf" ? ".pdf" : options.mime === "image/png" ? ".png" : options.mime === "image/webp" ? ".webp" : ".jpg";
  let pageCount: number | null = null;
  if (options.mime === "application/pdf") {
    await import("pdf-parse/worker");
    const parser = new PDFParse({ data: Uint8Array.from(options.bytes) });
    try {
      const info = await parser.getInfo({ parsePageInfo: false });
      pageCount = info.total;
      if (!Number.isInteger(pageCount) || pageCount < 1) throw new ApiFailure(422, "Non riesco a determinare il numero di pagine del PDF.");
      if (pageCount > 40) throw new ApiFailure(413, "L'OCR è limitato a 40 pagine per PDF. Dividi il documento e riprova.");
    } finally { await parser.destroy(); }
  }
  const tempDir = join(getLocalDataDirectory(), "ocr", "tmp"); await mkdir(tempDir, { recursive: true, mode: 0o700 });
  const input = join(tempDir, `${randomUUID()}${ext}`);
  await writeFile(input, options.bytes, { mode: 0o600 });
  activeVersions.set(version, (activeVersions.get(version) ?? 0) + 1);
  try {
    const result = await execFile(pythonFor(version), [join(process.cwd(), "python", "forgecy_paddleocr.py"), "--input", input], { env: envFor(version), timeout: 15 * 60_000, maxBuffer: 24_000_000, windowsHide: true });
    const payload = JSON.parse(result.stdout) as { text?: unknown; pageCount?: unknown; images?: unknown };
    const body = typeof payload.text === "string" ? payload.text.trim().slice(0, 80_000) : "";
    if (body.length < 20) throw new ApiFailure(422, "Il parser locale non ha trovato testo leggibile nel documento.");
    const images: OcrImage[] = [];
    for (const entry of Array.isArray(payload.images) ? payload.images : []) {
      const image = entry as { mime?: unknown; base64?: unknown };
      if (typeof image.base64 !== "string" || !["image/png", "image/jpeg", "image/webp"].includes(String(image.mime))) continue;
      const bytes = Buffer.from(image.base64, "base64");
      if (!bytes.length || bytes.length > 5_000_000 || images.length >= 8) continue;
      const mime = image.mime as OcrImage["mime"];
      images.push({ dataUrl: `data:${mime};base64,${image.base64}`, mime, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    return { body, images, pageCount: pageCount ?? (Number.isInteger(payload.pageCount) ? Number(payload.pageCount) : null), model: `PaddleOCR-VL ${version}`, engine: "paddleocr-vl-local" as OcrResult["engine"], provider: "local" };
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure(422, "Il parser locale non è riuscito a leggere il file. Puoi riprovare con OpenRouter.");
  } finally {
    await rm(input, { force: true }).catch(() => undefined);
    const count = (activeVersions.get(version) ?? 1) - 1;
    if (count <= 0) activeVersions.delete(version); else activeVersions.set(version, count);
    if (count <= 0) void currentVersion().then(active => active ? pruneOldVersions(active) : undefined);
  }
}
