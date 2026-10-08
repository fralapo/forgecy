/**
 * Safe handling of a backup archive that may have come from elsewhere (upload). A Forgecy
 * backup holds only regular files and folders, so anything else (symlinks, hard links,
 * devices) is refused BEFORE tar writes a single byte, extraction happens in a fresh empty
 * folder without restoring owners, and the extracted tree is walked again afterwards.
 * Names with `..` or a leading `/` are refused by tar itself (GNU and bsdtar).
 */
import { spawn } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runTool, TAR_ENV } from "./archive";

// ponytail: no --quoting-style=escape. It is GNU-only (bsdtar rejects it) and a newline in a
// member name can only add extra listing lines, which at worst refuse a good archive.

export class UnsafeArchiveError extends Error {
  constructor(detail: string) {
    super(`Unsafe backup archive: ${detail}`);
    this.name = "UnsafeArchiveError";
  }
}

/** `tar -tv` prints the entry type first: "-" regular file, "d" directory. */
export const isPlainTarEntry = (line: string): boolean =>
  line === "" || line[0] === "-" || line[0] === "d";

/** Streams the listing and stops at the first link or special file. */
export async function assertPlainTar(file: string): Promise<void> {
  const child = spawn("tar", ["-tvzf", file], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...TAR_ENV },
  });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  exit.catch(() => undefined); // surfaced below; avoids an unhandled rejection while we read
  let refused: string | null = null;
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    if (!isPlainTarEntry(line)) {
      refused = line;
      child.kill();
      break;
    }
  }
  const code = await exit;
  if (refused !== null)
    throw new UnsafeArchiveError(`link or special file: ${refused.slice(0, 200)}`);
  if (code !== 0) throw new Error(`tar exited with ${code}: ${stderr}`);
}

/**
 * The extracted tree must hold only regular files and folders (no symlinks, devices, pipes),
 * and no file with several names: bsdtar can list a hard link as a regular file.
 */
export async function assertPlainTree(root: string): Promise<void> {
  for (const name of await readdir(root)) {
    const path = join(root, name);
    const info = await lstat(path);
    if (info.isDirectory()) await assertPlainTree(path);
    else if (!info.isFile() || info.nlink > 1)
      throw new UnsafeArchiveError(`not a plain regular file: ${name}`);
  }
}

/**
 * Extracts a backup into `work` (a fresh, empty folder). Without `members` the whole archive
 * is listed first; with `members` (a manifest peek) only those names are extracted.
 */
export async function extractBackupArchive(
  file: string,
  work: string,
  members?: string[],
): Promise<void> {
  if (!members) await assertPlainTar(file);
  await runTool(
    "tar",
    ["-xzf", file, "-C", work, "--no-same-owner", "--no-same-permissions", ...(members ?? [])],
    TAR_ENV,
  );
  await assertPlainTree(work);
}
