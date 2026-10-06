import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { contentKey, type StorageDriver } from "@forgecy/files";
import { ImportError } from "./import/errors";

export interface TempFile {
  path: string;
  size: number;
  sha256: string;
  /** First bytes, for type sniffing. */
  head: Uint8Array;
  cleanup(): Promise<void>;
}

/**
 * Stream an upload to a private temp file, hashing it and stopping at `maxBytes`
 * so a client can never fill the disk with one request.
 */
export async function spoolToTemp(
  body: Readable | AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<TempFile> {
  const dir = await mkdtemp(path.join(tmpdir(), "forgecy-import-"));
  const file = path.join(dir, randomUUID());
  const hash = createHash("sha256");
  let size = 0;
  const head: number[] = [];
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    await pipeline(
      body,
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > maxBytes)
            throw new ImportError("IMPORT-TOO-LARGE", "The file exceeds the maximum allowed size.");
          if (head.length < 4096) head.push(...chunk.subarray(0, 4096 - head.length));
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(file, { mode: 0o600 }),
    );
  } catch (err) {
    await cleanup();
    if (err instanceof Error && "code" in err && err.code === "ENOSPC")
      throw new ImportError(
        "DISK-FULL",
        "Disk space is full: the files were not saved. Tell whoever runs the Forgecy server.",
      );
    throw err;
  }
  return { path: file, size, sha256: hash.digest("hex"), head: Uint8Array.from(head), cleanup };
}

/** Store a temp file content-addressed under the client's import area. */
export async function storeTempFile(
  storage: StorageDriver,
  input: { clientId: string; temp: TempFile; ext: string; mime: string },
): Promise<string> {
  const key = contentKey({
    clientId: input.clientId,
    scope: "imports",
    sha256: input.temp.sha256,
    ext: input.ext,
  });
  if (!(await storage.exists(key)))
    await storage.put(key, createReadStream(input.temp.path), {
      contentType: input.mime,
      contentLength: input.temp.size,
    });
  return key;
}

export async function storeBuffer(
  storage: StorageDriver,
  input: { clientId: string; data: Uint8Array; ext: string; mime: string; scope?: string },
): Promise<{ key: string; sha256: string }> {
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const key = contentKey({
    clientId: input.clientId,
    scope: input.scope ?? "imports",
    sha256,
    ext: input.ext,
  });
  if (!(await storage.exists(key)))
    await storage.put(key, input.data, {
      contentType: input.mime,
      contentLength: input.data.length,
    });
  return { key, sha256 };
}

/** Read a stored object fully, refusing anything larger than `maxBytes`. */
export async function readStored(
  storage: StorageDriver,
  key: string,
  maxBytes: number,
): Promise<Buffer> {
  const stream = await storage.get(key);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of stream) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array);
    size += b.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new ImportError("IMPORT-TOO-LARGE", "The file exceeds the maximum allowed size.");
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** Copy a stored object to a temp file (ZIPs need random access). */
export async function downloadToTemp(
  storage: StorageDriver,
  key: string,
): Promise<{ path: string; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "forgecy-zip-"));
  const file = path.join(dir, "archive.zip");
  await pipeline(await storage.get(key), createWriteStream(file, { mode: 0o600 }));
  return { path: file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function readTempFile(temp: Pick<TempFile, "path" | "size">): Promise<Buffer> {
  const fh = await open(temp.path, "r");
  try {
    return await fh.readFile();
  } finally {
    await fh.close();
  }
}
