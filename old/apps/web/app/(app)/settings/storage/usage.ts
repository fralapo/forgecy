import "server-only";
import { opendir, stat, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveMediaRoot } from "@forgecy/files";
import { env } from "@/lib/env";

export interface DiskSpace {
  totalBytes: number;
  freeBytes: number;
}

export interface StorageUsage {
  /** Bytes per logical area (assets, exports, thumbs...), across clients and agency files. */
  byArea: { area: string; bytes: number; files: number }[];
  backupsBytes: number;
  /** True when the walk stopped at the file limit: totals are a lower bound. */
  truncated: boolean;
}

const FILE_LIMIT = 200_000;

export const mediaRoot = () => resolveMediaRoot(env.MEDIA_ROOT);
export const backupsDir = () => join(resolveMediaRoot(env.FORGECY_DATA_DIR), "backups");

/** Space of the disk holding `path`; before the folder exists, of its nearest existing parent. */
export async function diskSpace(path: string): Promise<DiskSpace | null> {
  for (let dir = path; ; dir = dirname(dir)) {
    try {
      const s = await statfs(dir);
      return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
    } catch {
      if (dirname(dir) === dir) return null;
    }
  }
}

async function walk(
  dir: string,
  budget: { left: number },
): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  let handle;
  try {
    handle = await opendir(dir);
  } catch {
    return { bytes, files };
  }
  for await (const entry of handle) {
    if (budget.left <= 0) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walk(path, budget);
      bytes += sub.bytes;
      files += sub.files;
    } else if (entry.isFile()) {
      budget.left--;
      files++;
      bytes += (await stat(path).catch(() => ({ size: 0 }))).size;
    }
  }
  return { bytes, files };
}

async function children(dir: string): Promise<string[]> {
  try {
    const out: string[] = [];
    for await (const e of await opendir(dir)) if (e.isDirectory()) out.push(e.name);
    return out;
  } catch {
    return [];
  }
}

/** Local disk only: keys are `clients/<id>/<area>/...` or `system/<area>/...`. */
export async function localUsage(): Promise<StorageUsage> {
  const root = mediaRoot();
  const budget = { left: FILE_LIMIT };
  const areas = new Map<string, { bytes: number; files: number }>();
  const add = async (area: string, dir: string) => {
    const r = await walk(dir, budget);
    const prev = areas.get(area) ?? { bytes: 0, files: 0 };
    areas.set(area, { bytes: prev.bytes + r.bytes, files: prev.files + r.files });
  };
  for (const client of await children(join(root, "clients")))
    for (const area of await children(join(root, "clients", client)))
      await add(area, join(root, "clients", client, area));
  for (const area of await children(join(root, "system")))
    await add(area, join(root, "system", area));
  const backups = await walk(backupsDir(), { left: FILE_LIMIT });
  return {
    byArea: [...areas.entries()]
      .map(([area, v]) => ({ area, ...v }))
      .filter((a) => a.files > 0)
      .sort((a, b) => b.bytes - a.bytes),
    backupsBytes: backups.bytes,
    truncated: budget.left <= 0,
  };
}
