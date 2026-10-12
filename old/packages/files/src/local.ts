import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { ForgecyError } from "@forgecy/core";
import {
  MAX_SIGNED_URL_SECONDS,
  type ObjectInfo,
  type PutOptions,
  type SignedUrlOptions,
  type StorageDriver,
} from "./driver";
import { assertValidKey, contentTypeForKey } from "./keys";
import { signFileUrl } from "./signing";

export interface LocalDiskDriverOptions {
  /** Directory holding the files (MEDIA_ROOT). */
  root: string;
  /** Public base URL of the web app (FORGECY_BASE_URL). */
  baseUrl: string;
  /** HMAC secret for signed URLs (see deriveFileSigningSecret). */
  secret: string;
  /** Route prefix served by the web app. */
  routePath?: string;
}

/** Stores files under MEDIA_ROOT; signed URLs point to the web app's file route. */
export class LocalDiskDriver implements StorageDriver {
  readonly name = "local" as const;
  private readonly root: string;
  private readonly baseUrl: string;
  private readonly routePath: string;

  constructor(private readonly options: LocalDiskDriverOptions) {
    if (!options.secret || options.secret.length < 16)
      throw new Error("LocalDiskDriver: secret too short");
    this.root = path.resolve(options.root);
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.routePath = (options.routePath ?? "/api/files").replace(/\/+$/, "");
  }

  /** Absolute path of a key; rejects anything that escapes the root. */
  resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, ...key.split("/"));
    if (!full.startsWith(this.root + path.sep))
      throw new ForgecyError("validation", "Invalid storage key", { key });
    return full;
  }

  async put(key: string, body: Uint8Array | Readable, _options: PutOptions): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    // Write to a temp file then rename so readers never see a partial file.
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      const source = body instanceof Readable ? body : Readable.from([Buffer.from(body)]);
      await pipeline(source, createWriteStream(tmp, { flags: "wx" }));
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<Readable> {
    const file = this.resolve(key);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new ForgecyError("not_found", "File not found", { key });
    return createReadStream(file);
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const info = await stat(this.resolve(key)).catch(() => null);
    if (!info?.isFile()) return null;
    return { key, size: info.size, contentType: contentTypeForKey(key), lastModified: info.mtime };
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    assertValidKey(key);
    const ttl = Math.min(Math.max(1, Math.floor(options.expiresInSeconds)), MAX_SIGNED_URL_SECONDS);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = signFileUrl(key, exp, this.options.secret, options.disposition, options.filename);
    const params = new URLSearchParams({ exp: String(exp), sig });
    if (options.disposition) params.set("disp", options.disposition);
    if (options.filename) params.set("fn", options.filename);
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}${this.routePath}/${encodedKey}?${params.toString()}`;
  }

  async signedUploadUrl(): Promise<null> {
    return null;
  }
}
