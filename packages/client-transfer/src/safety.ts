/**
 * A client package is untrusted input: whoever built it chose every id and key in it. These
 * checks keep a package inside the client it creates. Ids are lower-case canonical uuids and
 * compared exactly, the same way the importer maps them.
 */
import { createHash } from "node:crypto";
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

/**
 * Deepest nesting of arrays and objects a row may have (JSON that is itself stored in a string
 * counts on top of the value around it). Forgecy's own rows stay far below this; a package
 * that goes deeper is hostile, and recursion without a bound would overflow the stack.
 */
export const MAX_JSON_DEPTH = 64;

const tooDeep = () => new UnsafePackageError(`data is nested deeper than ${MAX_JSON_DEPTH} levels`);

/**
 * Calls `visit` with every string of a parsed value: values, object keys, and the strings of
 * JSON that is itself stored in a string (a text column holding JSON, however its characters
 * are escaped). Plain recursion bounded by MAX_JSON_DEPTH; no generator delegation, which would
 * cost the whole depth for every string.
 */
function walkStrings(value: unknown, visit: (s: string) => void, depth = 0): void {
  if (typeof value === "string") {
    visit(value);
    if (/^\s*[{[]/.test(value)) {
      let inner: unknown;
      try {
        inner = JSON.parse(value);
      } catch {
        return;
      }
      walkStrings(inner, visit, depth);
    }
  } else if (Array.isArray(value)) {
    if (depth >= MAX_JSON_DEPTH) throw tooDeep();
    for (const v of value) walkStrings(v, visit, depth + 1);
  } else if (value && typeof value === "object") {
    if (depth >= MAX_JSON_DEPTH) throw tooDeep();
    for (const k in value) {
      if (!Object.hasOwn(value, k)) continue;
      walkStrings(k, visit, depth + 1);
      walkStrings((value as Record<string, unknown>)[k], visit, depth + 1);
    }
  }
}

/** A copy of a parsed value with `fn` applied to every string, object keys included. */
export function mapStrings(value: unknown, fn: (s: string) => string, depth = 0): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) {
    if (depth >= MAX_JSON_DEPTH) throw tooDeep();
    return value.map((v) => mapStrings(v, fn, depth + 1));
  }
  if (value && typeof value === "object") {
    if (depth >= MAX_JSON_DEPTH) throw tooDeep();
    // fromEntries defines own properties, so a "__proto__" key stays a plain key.
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [fn(k), mapStrings(v, fn, depth + 1)]),
    );
  }
  return value;
}

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Package ids in `text` replaced by their new ones (exact match; others are left as they are). */
export const remapIds = (text: string, idMap: ReadonlyMap<string, string>): string =>
  text.replace(UUID_ANYWHERE, (m) => idMap.get(m) ?? m);

/**
 * The rows of a table with every id remapped. It works on the parsed values, the same form the
 * checks read, so the spelling of an id in the file (JSON unicode escapes) cannot matter.
 */
export const remapRows = (jsonText: string, idMap: ReadonlyMap<string, string>): Row[] =>
  mapStrings(JSON.parse(jsonText), (s) => remapIds(s, idMap)) as Row[];

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
      walkStrings(r, (s) => {
        for (const m of s.matchAll(TENANT_KEY))
          if (m[0] !== `clients/${scope.clientId}/`)
            throw new UnsafePackageError("a file of another client is referenced", table.name);
      });
    }
  }
}

/**
 * Import side of `nullIfOutside` references: only a row that exists here (after the remap)
 * survives. The same for the ids in `uuid[]` columns, which keep just those that do.
 */
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
  for (const ref of table.arrayRefs)
    if (ref.column in row) {
      const ids = row[ref.column];
      row[ref.column] = Array.isArray(ids)
        ? ids.filter((v) => typeof v === "string" && hereIds.get(ref.target)?.has(v))
        : [];
    }
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

/** Passes the chunks through and fails if the total size or the sha-256 is not what the manifest says. */
export async function* verifiedChunks(
  source: AsyncIterable<unknown>,
  expect: { sha256: string; bytes: number },
): AsyncGenerator<Buffer> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of source) {
    const b = chunk as Buffer;
    bytes += b.length;
    if (bytes > expect.bytes)
      throw new UnsafePackageError("a file is larger than the manifest says");
    hash.update(b);
    yield b;
  }
  if (bytes !== expect.bytes || hash.digest("hex") !== expect.sha256)
    throw new UnsafePackageError("a file does not match its checksum");
}

const readRows = async (pkg: ClientPackage, table: string): Promise<Row[]> => {
  let text: string;
  try {
    text = await pkg.text(`data/${table}.json`);
  } catch (err) {
    // A refusal for size or safety is that, not an unreadable file.
    if (err instanceof UnsafePackageError) throw err;
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
