/**
 * A client package is untrusted input: whoever built it chose every id and key in it. These
 * checks keep a package inside the client it creates. Ids are lower-case canonical uuids and
 * compared exactly, the same way the importer maps them.
 */
import type { ClientImportProblem } from "@forgecy/core";
import { isValidKey } from "@forgecy/files";
import type { PackageManifest } from "./export";
import { clientTables, TABLE_AREAS, type ClientTable } from "./graph";
import type { ClientPackage } from "./package";

export type Row = Record<string, unknown>;

/** What the problem is called in the import report (`import.problems.<problem>`). */
type Problem = Extract<ClientImportProblem, "unsafe" | "incompleteArea" | "unreadable">;

/** Attacker-controlled text in a message: no control characters, at most 80 characters. */
const show = (text: string): string => {
  const clean = [...text.slice(0, 80)]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      return c < 32 || (c >= 127 && c < 160) ? "?" : ch;
    })
    .join("");
  return text.length > 80 ? `${clean}…` : clean;
};

export class UnsafePackageError extends Error {
  readonly problem: Problem;
  constructor(reason: string, table?: string, problem: Problem = "unsafe") {
    super(`Unsafe client package: ${reason}${table ? ` (${table})` : ""}`);
    this.name = "UnsafePackageError";
    this.problem = problem;
  }
}

/**
 * Ids are lower-case canonical uuids, the only form the exporter writes. The importer maps ids
 * by exact string, so any other spelling of an id would slip past the checks and the remap.
 */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

// Found in any case (`CLIENTS/`, upper-case ids), then required to be exactly this client's prefix.
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

export interface PackageScope {
  clientId: string;
  /** Ids of the rows of the package, per table. */
  idsByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Areas the package carries (`client` always). */
  areas: ReadonlySet<string>;
}

/** A reference must name a row of `target` in the package; else say whether an area is missing. */
function assertInside(
  table: string,
  column: string,
  value: unknown,
  target: string,
  scope: PackageScope,
) {
  if (!isId(value)) throw new UnsafePackageError(`${column} is not a valid id`, table);
  const inside =
    target === "clients" ? value === scope.clientId : !!scope.idsByTable.get(target)?.has(value);
  if (inside) return;
  const area = TABLE_AREAS[target];
  // Areas are optional and independent: a reference into one that was left out is a partial
  // export, not (necessarily) an attack. It is refused all the same, with a clearer message.
  if (area && area !== "client" && !scope.areas.has(area))
    throw new UnsafePackageError(
      `${column} points to the ${area} area, which is not in the package`,
      table,
      "incompleteArea",
    );
  throw new UnsafePackageError(`${column} points outside the package`, table);
}

export function assertPackageScoped(
  tables: readonly ClientTable[],
  rows: ReadonlyMap<string, readonly Row[]>,
  scope: PackageScope,
): void {
  for (const table of tables) {
    for (const r of rows.get(table.name) ?? []) {
      if ("id" in r && !isId(r.id))
        throw new UnsafePackageError("id is not a lower-case uuid", table.name);
      // Whatever the schema says about its foreign keys, a row's client_id is this client or empty.
      if (table.hasClientId && r.client_id != null && r.client_id !== scope.clientId)
        throw new UnsafePackageError("client_id is another client", table.name);
      for (const fk of table.parents) {
        if (!(fk.column in r)) continue;
        const v = r[fk.column];
        if (v == null) {
          if (fk.notNull) throw new UnsafePackageError(`${fk.column} is empty`, table.name);
          continue;
        }
        assertInside(table.name, fk.column, v, fk.target, scope);
      }
      for (const ref of table.softRefs) {
        const v = r[ref.column];
        if (v == null) {
          if (ref.notNull && ref.column in r)
            throw new UnsafePackageError(`${ref.column} is empty`, table.name);
          continue;
        }
        // The import empties these unless they point into the package: nothing to check.
        if (ref.mode === "package") assertInside(table.name, ref.column, v, ref.target, scope);
      }
      for (const d of table.droppedColumns)
        if (d.notNull && r[d.column] != null)
          throw new UnsafePackageError(`${d.column} needs data that does not travel`, table.name);
      for (const s of strings(r))
        for (const m of s.matchAll(TENANT_KEY))
          if (m[0] !== `clients/${scope.clientId}/`)
            throw new UnsafePackageError("a file of another client is referenced", table.name);
    }
  }
}

/** Import side of `nullIfOutside` references: only a row that exists here (after the remap) survives. */
export function emptyOutsideRefs(
  table: ClientTable,
  row: Row,
  hereIds: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  for (const ref of table.softRefs)
    if (
      ref.mode === "nullIfOutside" &&
      row[ref.column] != null &&
      !hereIds.get(ref.target)?.has(String(row[ref.column]))
    )
      row[ref.column] = null;
}

/** Keys the import may write: this client's own, or content-addressed agency files. */
export function assertImportKey(key: string, clientId: string, fileSha256?: string): void {
  if (!isValidKey(key)) throw new UnsafePackageError(`invalid storage key ${show(key)}`);
  const own = key.startsWith(`clients/${clientId}/`);
  const system = SYSTEM_KEY.exec(key);
  if (!own && !system) throw new UnsafePackageError(`storage key outside the client: ${show(key)}`);
  const stem = STEM.exec(key)?.[1];
  if (fileSha256 && stem && stem !== fileSha256)
    throw new UnsafePackageError(`checksum does not match the file name: ${show(key)}`);
}

const readRows = async (pkg: ClientPackage, table: string): Promise<Row[]> => {
  let text: string;
  try {
    text = await pkg.text(`data/${table}.json`);
  } catch {
    throw new UnsafePackageError("table data cannot be read", table, "unreadable");
  }
  try {
    const parsed: unknown = JSON.parse(text);
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
  const clientId = manifest.client.id;
  if (!isId(clientId)) throw new UnsafePackageError("the client id is not a lower-case uuid");
  const tables = clientTables().filter((t) => pkg.has(`data/${t.name}.json`));
  const rows = new Map<string, Row[]>();
  const idsByTable = new Map<string, Set<string>>([["clients", new Set([clientId])]]);
  for (const t of tables) {
    const parsed = await readRows(pkg, t.name);
    rows.set(t.name, parsed);
    const ids = idsByTable.get(t.name) ?? new Set<string>();
    for (const r of parsed) if (typeof r.id === "string") ids.add(r.id);
    idsByTable.set(t.name, ids);
  }
  const clientRows = rows.get("clients");
  if (!clientRows || clientRows.length !== 1 || clientRows[0]!.id !== clientId)
    throw new UnsafePackageError("the client row does not match the manifest", "clients");
  // Judged by the data that is there, not by what the manifest claims.
  const areas = new Set<string>(["client", ...tables.map((t) => t.area)]);
  assertPackageScoped(tables, rows, { clientId, idsByTable, areas });
  for (const f of manifest.files) assertImportKey(f.key, clientId, f.sha256);
}
