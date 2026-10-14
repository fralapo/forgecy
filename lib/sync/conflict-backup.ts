import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function saveLocalConflictCopy(dataDirectory: string, archive: Uint8Array, createdAt: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Hash dello snapshot di conflitto non valido.");
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) throw new Error("Data dello snapshot di conflitto non valida.");
  const directory = join(dataDirectory, "conflicts");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch { /* Windows inherits the private app data ACL. */ }
  const path = join(directory, `local-${timestamp}-${hash.slice(0, 12)}.forgecy.zip`);
  writeFileSync(path, archive, { flag: "wx", mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* Windows inherits the private app data ACL. */ }
  return path;
}
