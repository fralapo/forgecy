/**
 * Builds the package of one client (spec page 68): a ZIP with `manifest.json`, one
 * JSON file per table (`data/<table>.json`, rows as Postgres writes them), the files
 * those rows point to (`files/<storage key>`), the authors (`people.json`: name and
 * email only) and, optionally, the client's activity (`activity.csv`). Never keys,
 * settings or data of other clients.
 */
import { createWriteStream } from "node:fs";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CLIENT_PACKAGE_FORMAT,
  CLIENT_PACKAGE_MAX_JSON_BYTES,
  CLIENT_PACKAGE_MAX_JSON_TOTAL_BYTES,
  type ClientTransferArea,
} from "@forgecy/core";
import { migrationStatus, sql, type Database } from "@forgecy/db";
import { isValidKey, sha256, type StorageDriver } from "@forgecy/files";
import { ZipFile } from "yazl";
import { clientTables, type ClientTable } from "./graph";

export interface ExportOptions {
  clientId: string;
  areas: readonly ClientTransferArea[];
  excludeUnapprovedAi: boolean;
  includeAgencyTemplates: boolean;
}

export interface PackageManifest {
  format: number;
  app: "forgecy";
  exportedAt: string;
  schema: { migrations: number; last: string | null };
  client: { id: string; name: string; slug: string };
  areas: ClientTransferArea[];
  options: { excludeUnapprovedAi: boolean; includeAgencyTemplates: boolean };
  tables: Record<string, { rows: number; sha256: string }>;
  files: { key: string; bytes: number; sha256: string }[];
  people: number;
}

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Storage keys mentioned anywhere in a row (columns or JSON): this client's or the agency's. */
function keysIn(text: string, clientId: string): string[] {
  const re = new RegExp(`(?:clients/${clientId}|system)/[A-Za-z0-9._/-]+`, "g");
  return [...new Set(text.match(re) ?? [])].filter(isValidKey);
}

async function selectRows(
  db: Database,
  table: ClientTable,
  where: ReturnType<typeof sql>,
): Promise<{ text: string; rows: Row[] }> {
  const res = await db.execute<{ data: string }>(
    sql`select coalesce(json_agg(t), '[]'::json)::text as data
        from ${sql.identifier(table.name)} t where ${where}`,
  );
  const text = res.rows[0]?.data ?? "[]";
  return { text, rows: JSON.parse(text) as Row[] };
}

function whereFor(
  table: ClientTable,
  opts: ExportOptions,
  ids: Map<string, string[]>,
): ReturnType<typeof sql> | null {
  if (table.name === "clients") return sql`t.id = ${opts.clientId}`;
  if (table.name === "templates") {
    const own = sql`t.client_id = ${opts.clientId}`;
    if (!opts.includeAgencyTemplates) return own;
    // Agency templates the client's carousels and Brand Books were made with.
    return sql`(${own} or (t.client_id is null and t.key in (
      select template_key from contents where client_id = ${opts.clientId} and template_key is not null
      union select template_key from brand_book_exports where client_id = ${opts.clientId} and template_key is not null)))`;
  }
  let where: ReturnType<typeof sql>;
  if (table.hasClientId) where = sql`t.client_id = ${opts.clientId}`;
  else {
    const parent = table.parents.find((p) => p.notNull && p.target !== table.name);
    if (!parent) return null;
    const parentIds = ids.get(parent.target) ?? [];
    if (!parentIds.length) return null;
    where = sql`t.${sql.identifier(parent.column)} = any(${`{${parentIds.join(",")}}`}::uuid[])`;
  }
  if (table.name === "assets" && opts.excludeUnapprovedAi)
    where = sql`${where} and not (t.source = 'ai' and t.status <> 'approved')`;
  return where;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The client's activity log as CSV (not imported back: it is history of this installation). */
async function activityCsv(db: Database, clientId: string): Promise<string> {
  const res = await db.execute<Row>(sql`
    select e.at, coalesce(u.name, e.actor) as actor, e.action, e.entity, e.entity_id, e.meta
    from audit_events e left join users u on u.id = e.actor_user_id
    where e.client_id = ${clientId} order by e.at`);
  const head = ["at", "actor", "action", "entity", "entity_id", "meta"];
  const lines = res.rows.map((r) =>
    head.map((h) => csvCell(r[h] instanceof Date ? (r[h] as Date).toISOString() : r[h])).join(","),
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}

/**
 * Writes the package to `outFile`. `onProgress` gets 0–100. Files referenced by rows but
 * missing from storage are left out (the rows still point to them).
 */
export async function writeClientPackage(
  deps: { db: Database; storage: StorageDriver },
  opts: ExportOptions,
  outFile: string,
  onProgress: (pct: number) => Promise<void> = async () => {},
  limits = {
    jsonBytes: CLIENT_PACKAGE_MAX_JSON_BYTES,
    jsonTotalBytes: CLIENT_PACKAGE_MAX_JSON_TOTAL_BYTES,
  },
): Promise<{ manifest: PackageManifest; counts: Record<string, number> }> {
  const { db, storage } = deps;
  const areas = new Set<string>(["client", ...opts.areas]);
  const tables = clientTables().filter((t) => areas.has(t.area));
  const zip = new ZipFile();
  const done = pipeline(zip.outputStream, createWriteStream(outFile));
  // An export refused for size destroys the stream; keep that rejection from surfacing as an
  // unhandled one (the awaited `done` below still reports a real write error).
  done.catch(() => {});
  const ids = new Map<string, string[]>();
  const tableInfo: PackageManifest["tables"] = {};
  const counts: Record<string, number> = {};
  const fileKeys = new Set<string>();
  const people = new Set<string>();
  let client: PackageManifest["client"] | null = null;

  // The reader refuses JSON above these caps, so an export that would exceed them fails here
  // with a clear reason instead of producing a package that imports as unsafe.
  let jsonTotal = 0;
  const tooLarge = (message: string): never => {
    (zip.outputStream as unknown as Readable).destroy();
    throw new Error(message);
  };
  const addJson = (name: string, bytes: Buffer) => {
    jsonTotal += bytes.length;
    if (bytes.length > limits.jsonBytes)
      tooLarge(`${name} is larger than a package may hold (${bytes.length} bytes)`);
    if (jsonTotal > limits.jsonTotalBytes)
      tooLarge("The data of this client is larger than a package may hold");
    zip.addBuffer(bytes, name);
  };

  for (const [i, table] of tables.entries()) {
    const where = whereFor(table, opts, ids);
    const { text, rows } = where ? await selectRows(db, table, where) : { text: "[]", rows: [] };
    if (table.name === "clients") {
      const c = rows[0];
      if (!c) throw new Error("Client not found");
      client = { id: String(c.id), name: String(c.name), slug: String(c.slug) };
    }
    ids.set(
      table.name,
      rows.map((r) => String(r.id)).filter((id) => UUID.test(id)),
    );
    for (const k of keysIn(text, opts.clientId)) fileKeys.add(k);
    for (const r of rows)
      for (const u of table.userColumns)
        if (typeof r[u.column] === "string") people.add(r[u.column] as string);
    const bytes = Buffer.from(text);
    addJson(`data/${table.name}.json`, bytes);
    tableInfo[table.name] = { rows: rows.length, sha256: sha256(bytes) };
    if (rows.length) counts[table.name] = rows.length;
    await onProgress(Math.round((i / tables.length) * 50));
  }

  const files: PackageManifest["files"] = [];
  let n = 0;
  for (const key of [...fileKeys].sort()) {
    n += 1;
    if (!(await storage.exists(key))) continue;
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.get(key)) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    zip.addBuffer(body, `files/${key}`);
    files.push({ key, bytes: body.length, sha256: sha256(body) });
    if (n % 20 === 0) await onProgress(50 + Math.round((n / fileKeys.size) * 40));
  }
  counts.files = files.length;

  const peopleRows = people.size
    ? (
        await db.execute<{ id: string; name: string; email: string }>(
          sql`select id, name, email from users where id = any(${`{${[...people].join(",")}}`}::uuid[])`,
        )
      ).rows
    : [];
  addJson("people.json", Buffer.from(JSON.stringify(peopleRows)));
  if (opts.areas.includes("activity"))
    zip.addBuffer(Buffer.from(await activityCsv(db, opts.clientId)), "activity.csv");

  const status = await migrationStatus(db).catch(() => null);
  const manifest: PackageManifest = {
    format: CLIENT_PACKAGE_FORMAT,
    app: "forgecy",
    exportedAt: new Date().toISOString(),
    schema: { migrations: status?.applied ?? 0, last: status?.lastApplied ?? null },
    client: client!,
    areas: [...opts.areas],
    options: {
      excludeUnapprovedAi: opts.excludeUnapprovedAi,
      includeAgencyTemplates: opts.includeAgencyTemplates,
    },
    tables: tableInfo,
    files,
    people: peopleRows.length,
  };
  addJson("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.end();
  await done;
  await onProgress(95);
  return { manifest, counts };
}
