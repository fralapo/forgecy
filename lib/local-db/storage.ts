import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { getLocalDataDirectory } from "./index";

const LIMITS: Record<string, number> = { "forgecy-sources": 10 * 1024 * 1024, "forgecy-assets": 15 * 1024 * 1024 };
const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".txt": "text/plain",
  ".md": "text/markdown", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function filePath(bucket: string, path: string) {
  if (!Object.hasOwn(LIMITS, bucket) || !path || path.includes("\\") || path.startsWith("/")) throw new Error("Percorso file non valido");
  const segments = path.split("/");
  if (segments.some(part => !part || part === "." || part === ".." || part.includes("\0"))) throw new Error("Percorso file non valido");
  const root = resolve(getLocalDataDirectory(), "files", bucket);
  const target = resolve(root, normalize(path));
  if (!target.startsWith(root + sep)) throw new Error("Percorso file non autorizzato");
  return target;
}

function signingKey() {
  const target = join(getLocalDataDirectory(), "local-file-signing.key");
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  try { return readFileSync(target); }
  catch {
    const generated = randomBytes(32);
    try { writeFileSync(target, generated, { flag: "wx", mode: 0o600 }); return generated; }
    catch { return readFileSync(target); }
  }
}
function signedToken(bucket: string, path: string, expires: number) {
  const payload = Buffer.from(`${bucket}\n${path}\n${expires}`).toString("base64url");
  const signature = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifyToken(bucket: string, path: string, token: string) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = createHmac("sha256", signingKey()).update(payload).digest();
  let received: Buffer;
  try { received = Buffer.from(signature, "base64url"); } catch { return false; }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8").split("\n");
    return decoded.length === 3 && decoded[0] === bucket && decoded[1] === path && Number(decoded[2]) >= Date.now();
  } catch { return false; }
}

export class LocalStorageBucket {
  constructor(private bucket: string) {
    if (!Object.hasOwn(LIMITS, bucket)) throw new Error("Archivio file sconosciuto");
  }
  async upload(path: string, file: ArrayBuffer | ArrayBufferView | Blob, options?: { contentType?: string; upsert?: boolean }) {
    try {
      const target = filePath(this.bucket, path);
      const bytes = file instanceof Blob
        ? Buffer.from(await file.arrayBuffer())
        : ArrayBuffer.isView(file) ? Buffer.from(file.buffer, file.byteOffset, file.byteLength) : Buffer.from(file);
      if (bytes.byteLength > LIMITS[this.bucket]) return { data: null, error: { message: "File troppo grande" } };
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, bytes, { flag: options?.upsert ? "w" : "wx", mode: 0o600 });
      return { data: { path }, error: null };
    } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : "Impossibile salvare il file" } }; }
  }
  async download(path: string) {
    try {
      const target = filePath(this.bucket, path);
      const bytes = readFileSync(target);
      if (bytes.byteLength > LIMITS[this.bucket]) return { data: null, error: { message: "File troppo grande" } };
      return { data: new Blob([bytes]), error: null };
    } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : "File non trovato" } }; }
  }
  async remove(paths: string[]) {
    const errors: string[] = [];
    for (const path of paths) {
      try { const target = filePath(this.bucket, path); if (existsSync(target)) unlinkSync(target); }
      catch (error) { errors.push(error instanceof Error ? error.message : "Impossibile eliminare il file"); }
    }
    return { data: paths.map(path => ({ name: path })), error: errors.length ? { message: errors.join("; ") } : null };
  }
  async createSignedUrl(path: string, _expiresIn: number) {
    try {
      filePath(this.bucket, path);
      const token = signedToken(this.bucket, path, Date.now() + Math.min(Math.max(_expiresIn, 10), 600) * 1000);
      const url = `/api/local-files?bucket=${encodeURIComponent(this.bucket)}&path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
      return { data: { signedUrl: url }, error: null };
    } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : "Percorso file non valido" } }; }
  }
}

export function readWorkspaceFile(bucket: string, path: string, token: string) {
  if (!verifyToken(bucket, path, token)) throw new Error("Collegamento al file scaduto o non valido");
  const target = filePath(bucket, path);
  return { bytes: readFileSync(target), contentType: MIME[extname(target).toLowerCase()] || "application/octet-stream" };
}
