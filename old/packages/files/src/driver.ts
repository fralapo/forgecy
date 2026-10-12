import type { Readable } from "node:stream";

export type ContentDisposition = "inline" | "attachment";

export interface PutOptions {
  contentType: string;
  /** Byte length when `body` is a stream; lets S3 upload without buffering. */
  contentLength?: number;
}

export interface ObjectInfo {
  key: string;
  size: number;
  contentType: string | undefined;
  lastModified: Date | undefined;
}

export interface SignedUrlOptions {
  /** Keep it short: private files are only served through short-lived URLs. */
  expiresInSeconds: number;
  disposition?: ContentDisposition;
  /** Download file name used with `disposition: "attachment"`. */
  filename?: string;
}

export interface SignedUploadOptions {
  contentType: string;
  expiresInSeconds: number;
}

/** Private object storage. Keys are relative POSIX paths, e.g. `clients/<id>/assets/<sha>.png`. */
export interface StorageDriver {
  readonly name: "local" | "s3";
  put(key: string, body: Uint8Array | Readable, options: PutOptions): Promise<void>;
  /** Throws ForgecyError("not_found") when the object is missing. */
  get(key: string): Promise<Readable>;
  /** Returns null when the object is missing. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Idempotent: deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, options: SignedUrlOptions): Promise<string>;
  /** Direct browser upload URL (presigned PUT). Null when the driver cannot do it (local disk). */
  signedUploadUrl(key: string, options: SignedUploadOptions): Promise<string | null>;
}

export const MAX_SIGNED_URL_SECONDS = 7 * 24 * 3600;
