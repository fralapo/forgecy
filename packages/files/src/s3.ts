import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ForgecyError } from "@forgecy/core";
import {
  MAX_SIGNED_URL_SECONDS,
  type ObjectInfo,
  type PutOptions,
  type SignedUploadOptions,
  type SignedUrlOptions,
  type StorageDriver,
} from "./driver";
import { assertValidKey } from "./keys";

export interface S3DriverOptions {
  bucket: string;
  region: string;
  /** e.g. http://minio:9000. Omit for AWS. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Required by MinIO and most self-hosted S3 servers. */
  forcePathStyle?: boolean;
  /** Inject a client (tests). */
  client?: S3Client;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    return (
      err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata.httpStatusCode === 404
    );
  }
  return false;
}

function contentDisposition(options: SignedUrlOptions): string | undefined {
  if (!options.disposition) return undefined;
  if (!options.filename) return options.disposition;
  const ascii = options.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${options.disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(options.filename)}`;
}

async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/** S3-compatible storage (MinIO, AWS S3, R2, …). Objects stay private; access is via presigned URLs. */
export class S3Driver implements StorageDriver {
  readonly name = "s3" as const;
  readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3DriverOptions) {
    this.bucket = options.bucket;
    this.client =
      options.client ??
      new S3Client({
        region: options.region,
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
        ...(options.accessKeyId && options.secretAccessKey
          ? {
              credentials: {
                accessKeyId: options.accessKeyId,
                secretAccessKey: options.secretAccessKey,
              },
            }
          : {}),
        // Default CRC checksums break presigned PUTs and some S3-compatible servers.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
  }

  async put(key: string, body: Uint8Array | Readable, options: PutOptions): Promise<void> {
    assertValidKey(key);
    // PutObject needs a known length for streams; buffer when the caller doesn't know it
    // (uploads are size-capped by validateUpload, so this stays bounded).
    const payload =
      body instanceof Readable && options.contentLength === undefined ? await toBuffer(body) : body;
    // The SDK pipes a stream body into the request and listens to nothing on it, so an error of
    // the stream (a checksum failure, a read error) would be an uncaught exception and the request
    // would be left waiting for bytes. Aborting turns it into a failed upload.
    const abort = new AbortController();
    const onError = (err: Error) => abort.abort(err);
    if (payload instanceof Readable) payload.once("error", onError);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: payload,
        ContentType: options.contentType,
        ...(options.contentLength !== undefined ? { ContentLength: options.contentLength } : {}),
      }),
      { abortSignal: abort.signal },
    );
  }

  async get(key: string): Promise<Readable> {
    assertValidKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = res.Body;
      if (!body) throw new ForgecyError("not_found", "File not found", { key });
      if (body instanceof Readable) return body;
      // Non-Node runtimes return a web stream.
      return Readable.fromWeb(
        (body as { transformToWebStream(): ReadableStream }).transformToWebStream() as never,
      );
    } catch (err) {
      if (isNotFound(err)) throw new ForgecyError("not_found", "File not found", { key });
      throw err;
    }
  }

  async head(key: string): Promise<ObjectInfo | null> {
    assertValidKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        key,
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
        lastModified: res.LastModified,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    assertValidKey(key);
    const disposition = contentDisposition(options);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(disposition ? { ResponseContentDisposition: disposition } : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: clampTtl(options.expiresInSeconds) });
  }

  async signedUploadUrl(key: string, options: SignedUploadOptions): Promise<string> {
    assertValidKey(key);
    // ContentType is signed: the browser must send the same Content-Type header.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: clampTtl(options.expiresInSeconds) });
  }
}

function clampTtl(seconds: number): number {
  return Math.min(Math.max(1, Math.floor(seconds)), MAX_SIGNED_URL_SECONDS);
}
