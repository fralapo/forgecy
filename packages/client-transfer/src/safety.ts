/**
 * A client package is untrusted input: whoever built it chose every id and key in it. These
 * checks keep a package inside the client it creates. Ids are compared in lower case.
 */
import { isValidKey } from "@forgecy/files";
import type { PackageManifest } from "./export";
import { clientTables, type ClientTable } from "./graph";
import type { ClientPackage } from "./package";

export type Row = Record<string, unknown>;

export class UnsafePackageError extends Error {
  constructor(reason: string, table?: string) {
    super(`Unsafe client package: ${reason}${table ? ` (${table})` : ""}`);
    this.name = "UnsafePackageError";
  }
}

const TENANT_KEY = /clients\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//gi;
const SYSTEM_KEY =
  /^system\/[a-z0-9][a-z0-9_-]{0,63}(?:\/[a-z0-9][a-z0-9_-]{0,63})*\/([a-f0-9]{64})\.[a-z0-9]{1,10}$/;
const STEM = /\/([a-f0-9]{64})\.[a-z0-9]{1,10}$/;

function* strings(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) yield* strings(v);
}

export function assertPackageScoped(
  tables: readonly ClientTable[],
  rows: ReadonlyMap<string, readonly Row[]>,
  scope: { clientId: string; allowedIds: ReadonlySet<string> },
): void {
  for (const table of tables) {
    for (const r of rows.get(table.name) ?? []) {
      // Whatever the schema says about its foreign keys, a row's client_id is this client or empty.
      if (table.hasClientId && r.client_id != null) {
        const owner = typeof r.client_id === "string" ? r.client_id.toLowerCase() : "";
        if (owner !== scope.clientId)
          throw new UnsafePackageError("client_id is another client", table.name);
      }
      for (const fk of table.parents) {
        if (!(fk.column in r)) continue;
        const v = r[fk.column];
        if (v == null) {
          if (fk.notNull) throw new UnsafePackageError(`${fk.column} is empty`, table.name);
          continue;
        }
        const id = typeof v === "string" ? v.toLowerCase() : "";
        const inside = fk.target === "clients" ? id === scope.clientId : scope.allowedIds.has(id);
        if (!inside)
          throw new UnsafePackageError(`${fk.column} points outside the package`, table.name);
      }
      for (const d of table.droppedColumns)
        if (d.notNull && r[d.column] != null)
          throw new UnsafePackageError(`${d.column} needs data that does not travel`, table.name);
      for (const s of strings(r))
        for (const m of s.matchAll(TENANT_KEY))
          if (m[1]!.toLowerCase() !== scope.clientId)
            throw new UnsafePackageError("a file of another client is referenced", table.name);
    }
  }
}

/** Keys the import may write: this client's own, or content-addressed agency files. */
export function assertImportKey(key: string, clientId: string, fileSha256?: string): void {
  if (!isValidKey(key)) throw new UnsafePackageError(`invalid storage key ${key}`);
  const own = key.startsWith(`clients/${clientId}/`);
  const system = SYSTEM_KEY.exec(key);
  if (!own && !system) throw new UnsafePackageError(`storage key outside the client: ${key}`);
  const stem = STEM.exec(key)?.[1];
  if (fileSha256 && stem && stem !== fileSha256)
    throw new UnsafePackageError(`checksum does not match the file name: ${key}`);
}

const readRows = async (pkg: ClientPackage, table: string): Promise<Row[]> => {
  try {
    const parsed: unknown = JSON.parse(await pkg.text(`data/${table}.json`));
    if (
      !Array.isArray(parsed) ||
      parsed.some((r) => !r || typeof r !== "object" || Array.isArray(r))
    )
      throw new Error("not rows");
    return parsed as Row[];
  } catch {
    throw new UnsafePackageError("table data is not a list of rows", table);
  }
};

/** Whole-package check in the package's own id space (used by Verify and again by Import). */
export async function assertPackageData(
  pkg: ClientPackage,
  manifest: PackageManifest,
): Promise<void> {
  const clientId = manifest.client.id.toLowerCase();
  const tables = clientTables().filter((t) => pkg.has(`data/${t.name}.json`));
  const rows = new Map<string, Row[]>();
  const allowedIds = new Set<string>([clientId]);
  for (const t of tables) {
    const parsed = await readRows(pkg, t.name);
    rows.set(t.name, parsed);
    for (const r of parsed) if (typeof r.id === "string") allowedIds.add(r.id.toLowerCase());
  }
  const clientRows = rows.get("clients");
  if (
    !clientRows ||
    clientRows.length !== 1 ||
    String(clientRows[0]!.id).toLowerCase() !== clientId
  )
    throw new UnsafePackageError("the client row does not match the manifest", "clients");
  assertPackageScoped(tables, rows, { clientId, allowedIds });
  for (const f of manifest.files) assertImportKey(f.key, clientId, f.sha256);
}
