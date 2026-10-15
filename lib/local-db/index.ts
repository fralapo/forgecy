/* eslint-disable @typescript-eslint/no-explicit-any -- this adapter preserves the existing dynamic query API. */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { JSON_COLUMNS, LOCAL_SCHEMA, TABLES } from "./schema";
import { splitSourceIntoChunks } from "../source-chunking";

export const LOCAL_OWNER_ID = "00000000-0000-4000-8000-000000000001";
export type DbError = { message: string; code?: string };
export type DbResult<T = any> = { data: T | null; error: DbError | null; count?: number | null };

function appDataPath() {
  if (process.env.FORGECY_DATA_DIR) return resolve(process.env.FORGECY_DATA_DIR);
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Forgecy");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Forgecy");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "forgecy");
}
export const getLocalDataDirectory = appDataPath;

function configure(db: Database.Database) {
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  db.exec(LOCAL_SCHEMA);
  const version = Number(db.pragma("user_version", { simple: true }));
  if (version > 12) throw new Error(`Database Forgecy v${version} non supportato da questa versione dell'app`);
  if (version < 2) {
    db.transaction(() => {
      const columns = db.pragma("table_info(social_accounts)") as { name: string }[];
      if (!columns.some(column => column.name === "needs_reauth"))
        db.exec("ALTER TABLE social_accounts ADD COLUMN needs_reauth INTEGER NOT NULL DEFAULT 0 CHECK(needs_reauth IN (0,1))");
      db.pragma("user_version = 2");
    })();
  }
  const currentVersion=Number(db.pragma("user_version",{simple:true}));
  if(currentVersion<4){
    db.transaction(()=>{
      db.exec(`CREATE TABLE website_crawl_requests_v4 (
       id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
       requested_by TEXT NOT NULL, hostname TEXT NOT NULL CHECK(length(hostname) BETWEEN 4 AND 253),
       page_budget INTEGER NOT NULL CHECK(page_budget BETWEEN 1 AND 100), requested_at TEXT NOT NULL
      );
      INSERT INTO website_crawl_requests_v4 SELECT * FROM website_crawl_requests;
      DROP TABLE website_crawl_requests;
      ALTER TABLE website_crawl_requests_v4 RENAME TO website_crawl_requests;
      CREATE INDEX website_crawl_client_window_idx ON website_crawl_requests(client_id,requested_at DESC);
      CREATE INDEX website_crawl_actor_window_idx ON website_crawl_requests(requested_by,requested_at DESC);
      PRAGMA user_version = 4;`);
    })();
  }
  const indexedVersion=Number(db.pragma("user_version",{simple:true}));
  if(indexedVersion<5){
    db.transaction(()=>{
      db.exec(`INSERT INTO source_chunk_fts(chunk_id,source_id,title,body)
        SELECT c.id,c.source_id,s.title,c.body FROM source_chunks c
        JOIN sources s ON s.id=c.source_id AND s.client_id=c.client_id
        WHERE s.status='ready';
        PRAGMA user_version = 5;`);
    })();
  }
  const currentSchemaVersion=Number(db.pragma("user_version",{simple:true}));
  if(currentSchemaVersion<6){
    db.transaction(()=>{
      const chunkColumns=db.pragma("table_info(source_chunks)") as {name:string}[];
      if(!chunkColumns.some(column=>column.name==="section_title"))
        db.exec("ALTER TABLE source_chunks ADD COLUMN section_title TEXT NOT NULL DEFAULT '' CHECK(length(section_title)<=240)");
      const preferenceColumns=db.pragma("table_info(ai_preferences)") as {name:string}[];
      if(!preferenceColumns.some(column=>column.name==="semantic_enabled"))
        db.exec("ALTER TABLE ai_preferences ADD COLUMN semantic_enabled INTEGER NOT NULL DEFAULT 0 CHECK(semantic_enabled IN (0,1))");
      db.pragma("user_version = 6");
    })();
  }
  const offerSchemaVersion=Number(db.pragma("user_version",{simple:true}));
  if(offerSchemaVersion<7){
    db.transaction(()=>{
      const offerColumns=db.pragma("table_info(offers)") as {name:string}[];
      if(!offerColumns.some(column=>column.name==="image_source_id"))
        db.exec("ALTER TABLE offers ADD COLUMN image_source_id TEXT REFERENCES sources(id) ON DELETE SET NULL");
      db.exec(`UPDATE offers SET status='verified',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE status='draft' AND kind='product' AND source_id IN (SELECT id FROM sources WHERE kind='website')`);
      db.pragma("user_version = 7");
    })();
  }
  const catalogSchemaVersion=Number(db.pragma("user_version",{simple:true}));
  if(catalogSchemaVersion<8){
    db.transaction(()=>{
      const offerColumns=db.pragma("table_info(offers)") as {name:string}[];
      if(!offerColumns.some(column=>column.name==="catalog_locked"))
        db.exec("ALTER TABLE offers ADD COLUMN catalog_locked INTEGER NOT NULL DEFAULT 0 CHECK(catalog_locked IN (0,1))");
      db.pragma("user_version = 8");
    })();
  }
  const ocrSchemaVersion=Number(db.pragma("user_version",{simple:true}));
  if(ocrSchemaVersion<9){
    db.transaction(()=>{
      const preferenceColumns=db.pragma("table_info(ai_preferences)") as {name:string}[];
      if(!preferenceColumns.some(column=>column.name==="ocr_model"))
        db.exec("ALTER TABLE ai_preferences ADD COLUMN ocr_model TEXT CHECK(ocr_model IS NULL OR length(ocr_model) BETWEEN 1 AND 180)");
      db.pragma("user_version = 9");
    })();
  }
  const semanticDefaultVersion=Number(db.pragma("user_version",{simple:true}));
  if(semanticDefaultVersion<11){
    db.transaction(()=>{
      // The former default was opt-in. Make the hybrid retriever the default;
      // users can still turn it off from Settings.
      db.exec("UPDATE ai_preferences SET semantic_enabled=1 WHERE semantic_enabled=0");
      // Older vector rows did not record the pinned model revision. Rebuild
      // them so backups and search never mix embeddings from unknown revisions.
      db.exec("DELETE FROM source_chunk_embeddings WHERE model_id='Xenova/paraphrase-multilingual-MiniLM-L12-v2'");
      db.pragma("user_version = 11");
    })();
  }
  const publicInstagramVersion=Number(db.pragma("user_version",{simple:true}));
  if(publicInstagramVersion<12){
    db.transaction(()=>{
      // The app no longer uses Meta OAuth; erase previously saved encrypted access tokens.
      db.exec("UPDATE social_accounts SET token_ciphertext='',token_expires_at=NULL,needs_reauth=0");
      db.pragma("user_version = 12");
    })();
  }
  return db;
}

declare global {
  var __forgecyLocalDb: Database.Database | undefined;
}

export function getLocalDatabase(): Database.Database {
  if (globalThis.__forgecyLocalDb?.open) return globalThis.__forgecyLocalDb;
  const directory = appDataPath();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch { /* ACLs provide the equivalent boundary on Windows. */ }
  const db = configure(new Database(join(directory, "forgecy.sqlite"), { timeout: 5000 }));
  try { chmodSync(join(directory, "forgecy.sqlite"), 0o600); } catch { /* Windows permissions are inherited from the private directory. */ }
  globalThis.__forgecyLocalDb = db;
  return db;
}

const now = () => new Date().toISOString();
const jsonEncode = (table: string, key: string, value: unknown) =>
  JSON_COLUMNS[table]?.has(key) && value !== null && typeof value !== "string" ? JSON.stringify(value) : value;
function decode(table: string, row: Record<string, unknown>) {
  const columns = JSON_COLUMNS[table];
  if (!columns) return row;
  for (const column of columns) {
    const value = row[column];
    if (typeof value === "string") {
      try { row[column] = JSON.parse(value); } catch { /* A malformed local value is returned for diagnostics. */ }
    }
  }
  return row;
}
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

type Filter = { field: string; op: "=" | "<>" | ">" | ">=" | "<" | "<=" | "in"; value: unknown };
type Mode = "select" | "insert" | "update" | "delete" | "upsert";

class LocalQuery<T = Record<string, any>[]> implements PromiseLike<DbResult<T>> {
  private mode: Mode = "select";
  private projection = "*";
  private values: Record<string, unknown> | Record<string, unknown>[] = {};
  private filters: Filter[] = [];
  private ordering: { field: string; ascending: boolean; nullsFirst?: boolean }[] = [];
  private maximum: number | undefined;
  private conflictFields: string[] = [];
  private returnRows = false;
  private cardinality: "many" | "single" | "maybe" = "many";
  private head = false;
  private countExact = false;

  constructor(private db: LocalDatabase, private table: string) {
    if (!TABLES.has(table)) throw new Error(`Tabella locale sconosciuta: ${table}`);
  }

  select(fields = "*", options?: { head?: boolean; count?: "exact" | "planned" | "estimated" }): LocalQuery<any[]> {
    this.projection = fields.trim() || "*";
    this.returnRows = this.mode !== "select";
    this.head = options?.head === true;
    this.countExact = options?.count === "exact";
    return this as unknown as LocalQuery<any[]>;
  }
  insert(values: Record<string, unknown> | Record<string, unknown>[]) { this.mode = "insert"; this.values = values; return this; }
  update(values: Record<string, unknown>) { this.mode = "update"; this.values = values; return this; }
  delete() { this.mode = "delete"; return this; }
  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string }) {
    this.mode = "upsert"; this.values = values; this.conflictFields = (options?.onConflict || "id").split(",").map(x => x.trim()); return this;
  }
  eq(field: string, value: unknown) { this.filters.push({ field, op: "=", value }); return this; }
  neq(field: string, value: unknown) { this.filters.push({ field, op: "<>", value }); return this; }
  gt(field: string, value: unknown) { this.filters.push({ field, op: ">", value }); return this; }
  gte(field: string, value: unknown) { this.filters.push({ field, op: ">=", value }); return this; }
  lt(field: string, value: unknown) { this.filters.push({ field, op: "<", value }); return this; }
  lte(field: string, value: unknown) { this.filters.push({ field, op: "<=", value }); return this; }
  in(field: string, value: unknown[]) { this.filters.push({ field, op: "in", value }); return this; }
  order(field: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.ordering.push({ field, ascending: options?.ascending !== false, nullsFirst: options?.nullsFirst }); return this;
  }
  limit(maximum: number) { this.maximum = maximum; return this; }
  range(from: number, to: number) { this.filters.push({ field: "__range", op: "in", value: [from, to] }); return this; }
  single(): LocalQuery<any> { this.cardinality = "single"; return this as unknown as LocalQuery<any>; }
  maybeSingle(): LocalQuery<any> { this.cardinality = "maybe"; return this as unknown as LocalQuery<any>; }
  then<TResult1 = DbResult<T>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return (this.execute() as Promise<DbResult<T>>).then(onfulfilled, onrejected);
  }

  private where() {
    const clauses: string[] = [];
    const parameters: unknown[] = [];
    let range: [number, number] | undefined;
    for (const filter of this.filters) {
      if (filter.field === "__range") { range = filter.value as [number, number]; continue; }
      const field = quote(this.db.column(this.table, filter.field));
      if (filter.op === "in") {
        const values = filter.value as unknown[];
        if (!values.length) clauses.push("0");
        else { clauses.push(`${field} IN (${values.map(() => "?").join(",")})`); parameters.push(...values.map(v => jsonEncode(this.table, filter.field, v))); }
      } else if (filter.value === null && (filter.op === "=" || filter.op === "<>")) {
        clauses.push(`${field} IS ${filter.op === "<>" ? "NOT " : ""}NULL`);
      } else {
        clauses.push(`${field} ${filter.op} ?`); parameters.push(jsonEncode(this.table, filter.field, filter.value));
      }
    }
    return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", parameters, range };
  }

  private execute(): Promise<DbResult<any>> {
    try {
      const db = this.db.connection;
      const { sql: where, parameters, range } = this.where();
      if (this.mode === "select") {
        const { sql: orderSql, parameters: orderParams } = this.orderSql();
        const offset = range?.[0] ?? 0;
        const limit = range ? range[1] - range[0] + 1 : this.maximum;
        const countRow = this.countExact ? db.prepare(`SELECT count(*) AS count FROM ${quote(this.table)}${where}`).get(...parameters) as { count: number } : undefined;
        const count = countRow ? Number(countRow.count) : undefined;
        if (this.head) return Promise.resolve({ data: null, error: null, count });
        const limitSql = limit === undefined ? "" : " LIMIT ? OFFSET ?";
        const params = [...parameters, ...orderParams, ...(limit === undefined ? [] : [limit, offset])];
        const rows = db.prepare(`SELECT ${this.projectionSql()} FROM ${quote(this.table)}${where}${orderSql}${limitSql}`).all(...params)
          .map(row => decode(this.table, row as Record<string, unknown>));
        return Promise.resolve(this.finish(rows, count));
      }
      const transaction = db.transaction(() => {
        if (this.mode === "insert") return this.insertRows(this.values as Record<string, unknown>[], false);
        if (this.mode === "upsert") return this.insertRows(this.values as Record<string, unknown>[], true);
        const oldRows = db.prepare(`SELECT * FROM ${quote(this.table)}${where}`).all(...parameters) as Record<string, unknown>[];
        if (this.mode === "delete") {
          for (const old of oldRows) db.prepare(`DELETE FROM ${quote(this.table)} WHERE id=?`).run(old.id);
          for (const old of oldRows) this.db.afterMutation(this.table, old, null);
          return oldRows;
        }
        const returned: Record<string, unknown>[] = [];
        for (const old of oldRows) {
          const next = this.db.beforeUpdate(this.table, old, this.values as Record<string, unknown>);
          const entries = Object.entries(next);
          const assignments = entries.map(([key]) => `${quote(this.db.column(this.table, key))}=?`).join(",");
          db.prepare(`UPDATE ${quote(this.table)} SET ${assignments} WHERE id=?`).run(...entries.map(([key, value]) => jsonEncode(this.table, key, value)), old.id);
          const updated = db.prepare(`SELECT * FROM ${quote(this.table)} WHERE id=?`).get(old.id) as Record<string, unknown>;
          this.db.afterMutation(this.table, old, updated);
          returned.push(updated);
        }
        return returned;
      });
      const rows = transaction() as Record<string, unknown>[];
      return Promise.resolve(this.finish(this.returnRows ? rows.map(row => decode(this.table, row)) : null));
    } catch (error) {
      return Promise.resolve({ data: null, error: { message: error instanceof Error ? error.message : "Errore SQLite", code: (error as { code?: string })?.code } });
    }
  }

  private insertRows(input: Record<string, unknown>[], upsert: boolean) {
    const rows: Record<string, unknown>[] = [];
    for (const raw of Array.isArray(input) ? input : [input]) {
      const value = this.db.defaults(this.table, raw);
      const match = upsert ? this.db.connection.prepare(`SELECT * FROM ${quote(this.table)} WHERE ${this.conflictFields.map(f => `${quote(this.db.column(this.table, f))} IS ?`).join(" AND ")}`).get(...this.conflictFields.map(f => value[f])) as Record<string, unknown> | undefined : undefined;
      if (match) {
        const next = this.db.beforeUpdate(this.table, match, value);
        const entries = Object.entries(next).filter(([key]) => key !== "id" && !this.conflictFields.includes(key));
        const identity = this.conflictFields.map(field => `${quote(this.db.column(this.table, field))} IS ?`).join(" AND ");
        const identityValues = this.conflictFields.map(field => jsonEncode(this.table, field, match[field]));
        this.db.connection.prepare(`UPDATE ${quote(this.table)} SET ${entries.map(([key]) => `${quote(this.db.column(this.table, key))}=?`).join(",")} WHERE ${identity}`).run(...entries.map(([key, v]) => jsonEncode(this.table, key, v)), ...identityValues);
        const updated = this.db.connection.prepare(`SELECT * FROM ${quote(this.table)} WHERE ${identity}`).get(...identityValues) as Record<string, unknown>;
        this.db.afterMutation(this.table, match, updated); rows.push(updated); continue;
      }
      const entries = Object.entries(value);
      this.db.connection.prepare(`INSERT INTO ${quote(this.table)} (${entries.map(([key]) => quote(this.db.column(this.table, key))).join(",")}) VALUES (${entries.map(() => "?").join(",")})`).run(...entries.map(([key, v]) => jsonEncode(this.table, key, v)));
      const identityFields = upsert ? this.conflictFields : ["id"];
      const identity = identityFields.map(field => `${quote(this.db.column(this.table, field))} IS ?`).join(" AND ");
      const identityValues = identityFields.map(field => jsonEncode(this.table, field, value[field]));
      const inserted = this.db.connection.prepare(`SELECT * FROM ${quote(this.table)} WHERE ${identity}`).get(...identityValues) as Record<string, unknown>;
      this.db.afterMutation(this.table, null, inserted); rows.push(inserted);
    }
    return rows;
  }

  private projectionSql() {
    if (this.projection === "*") return "*";
    return this.projection.split(",").map(part => {
      const field = part.trim();
      if (field === "*" || !/^[a-z_][a-z0-9_]*$/i.test(field)) throw new Error(`Campo non supportato: ${field}`);
      return quote(this.db.column(this.table, field));
    }).join(",");
  }
  private orderSql() {
    if (!this.ordering.length) return { sql: "", parameters: [] as unknown[] };
    return { sql: " ORDER BY " + this.ordering.map(order => `${quote(this.db.column(this.table, order.field))} ${order.ascending ? "ASC" : "DESC"}${order.nullsFirst === undefined ? "" : order.nullsFirst ? " NULLS FIRST" : " NULLS LAST"}`).join(","), parameters: [] as unknown[] };
  }
  private finish(rows: Record<string, unknown>[] | null, count?: number) {
    if (rows === null) return { data: null, error: null, ...(count === undefined ? {} : { count }) };
    if (this.cardinality === "many") return { data: rows, error: null, ...(count === undefined ? {} : { count }) };
    if (rows.length === 0 && this.cardinality === "maybe") return { data: null, error: null };
    if (rows.length !== 1) return { data: null, error: { message: rows.length ? "Expected one row" : "No rows returned", code: "LOCAL_CARDINALITY" } };
    return { data: rows[0], error: null };
  }
}

export class LocalDatabase {
  readonly connection: Database.Database;
  readonly storage: { from(bucket: string): LocalStorageBucket };
  constructor(connection = getLocalDatabase()) {
    this.connection = connection;
    this.storage = { from: bucket => new LocalStorageBucket(bucket) };
  }
  from(table: string) { return new LocalQuery<any[]>(this, table); }
  async rpc(name: string, args: Record<string, unknown> = {}): Promise<DbResult<any>> {
    try { return { data: this.runRpc(name, args), error: null }; }
    catch (error) {
      const message = error instanceof Error ? error.message : "Errore locale";
      const code = (error as { code?: string })?.code || (/limite|budget.*esaurito/i.test(message) ? "P0429" : undefined);
      return { data: null, error: { message, code } };
    }
  }
  column(table: string, field: string) {
    if (!TABLES.has(table)) throw new Error(`Tabella locale sconosciuta: ${table}`);
    const columns = this.connection.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[];
    if (!columns.some(column => column.name === field)) throw new Error(`Campo locale sconosciuto: ${table}.${field}`);
    return field;
  }
  defaults(table: string, input: Record<string, unknown>) {
    const value = { ...input };
    const columns = new Set((this.connection.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map(c => c.name));
    if (columns.has("id") && (value.id === undefined || value.id === null || value.id === "")) value.id = randomUUID();
    const time = now();
    for (const field of ["created_at", "updated_at", "collected_at", "requested_at", "run_after", "observed_at"]) {
      if (columns.has(field) && value[field] === undefined) value[field] = field === "observed_at" ? time.slice(0, 10) : time;
    }
    return value;
  }
  beforeUpdate(table: string, old: Record<string, unknown>, values: Record<string, unknown>) {
    const next = { ...values };
    if (table === "clients") {
      const changed = ["name", "industry", "website", "profile"].some(key => key in values && JSON.stringify(old[key]) !== JSON.stringify(values[key]));
      if (changed) next.knowledge_revision = Number(old.knowledge_revision || 0) + 1;
      next.updated_at = now();
    }
    if (table === "offers") { next.version = Number(old.version || 1) + 1; next.updated_at = now(); }
    if (table === "contents") {
      const creative = ["title", "caption", "slides", "editorial_brief"].some(key => key in values && JSON.stringify(old[key]) !== JSON.stringify(values[key]));
      next.revision = Number(old.revision || 1) + 1; next.updated_at = now();
      if (creative && old.status === "approved") next.status = "draft";
    }
    if (table === "editorial_entries") {
      if (("client_id" in values && values.client_id !== old.client_id) || ("created_by" in values && values.created_by !== old.created_by)) throw new Error("Proprietario del calendario immutabile");
      next.updated_at = now();
    }
    if (table === "missions" && values.status === "approved" && old.status !== "approved") {
      const strategy = this.connection.prepare("SELECT 1 FROM strategies s JOIN clients c ON c.id=s.client_id WHERE s.client_id=? AND s.status='approved' AND s.knowledge_revision=c.knowledge_revision").get(old.client_id);
      if (!strategy) throw new Error("Approva il piano strategico aggiornato prima della campagna");
    }
    return next;
  }
  afterMutation(table: string, old: Record<string, unknown> | null, next: Record<string, unknown> | null) {
    const row = next || old;
    if (!row) return;
    const clientId = String(row.client_id || "");
    if (table === "sources" || table === "offers") {
      if (clientId) {
        this.connection.prepare("UPDATE clients SET knowledge_revision=knowledge_revision+1, updated_at=? WHERE id=?").run(now(), clientId);
        this.connection.prepare("UPDATE dossiers SET status='stale' WHERE client_id=? AND status IN ('draft','approved')").run(clientId);
        this.connection.prepare("UPDATE strategies SET status='stale' WHERE client_id=? AND status IN ('draft','approved')").run(clientId);
        if (table === "offers") this.connection.prepare("UPDATE contents SET status='stale' WHERE client_id=? AND offer_id=? AND status<>'stale'").run(clientId, row.id);
      }
    }
    if (table === "clients" && old && Number(old.knowledge_revision) !== Number(next?.knowledge_revision)) {
      this.connection.prepare("UPDATE dossiers SET status='stale' WHERE client_id=? AND status IN ('draft','approved')").run(row.id);
      this.connection.prepare("UPDATE strategies SET status='stale' WHERE client_id=? AND status IN ('draft','approved')").run(row.id);
    }
    if (table === "contents" && old && next && ["title", "caption", "slides"].some(key => JSON.stringify(old[key]) !== JSON.stringify(next[key]))) {
      this.connection.prepare("UPDATE contents SET status='stale' WHERE parent_id=? AND client_id=? AND status<>'stale'").run(row.id, clientId);
    }
    if (table === "sources" && next && next.status === "ready") {
      const body = String(next.body || "");
      const insert = this.connection.prepare("INSERT OR REPLACE INTO source_chunks(client_id,source_id,ordinal,body,section_title,created_at) VALUES(?,?,?,?,?,?)");
      this.connection.prepare("DELETE FROM source_chunks WHERE source_id=?").run(next.id);
      for (const chunk of splitSourceIntoChunks(body))
        insert.run(clientId,next.id,chunk.ordinal,chunk.body,chunk.sectionTitle,now());
    } else if (table === "sources") this.connection.prepare("DELETE FROM source_chunks WHERE source_id=?").run(row.id);
  }
  snapshot(destination: string) { return this.connection.backup(destination); }

  private runRpc(name: string, a: Record<string, unknown>): any {
    const db = this.connection;
    const time = now();
    const client = (id: unknown) => db.prepare("SELECT * FROM clients WHERE id=?").get(id) as Record<string, unknown> | undefined;
    const rows = (sql: string, ...values: unknown[]) => db.prepare(sql).all(...values) as Record<string, unknown>[];
    const insert = (table: string, input: Record<string, unknown>) => {
      const value = this.defaults(table, input);
      const fields = Object.keys(value);
      db.prepare(`INSERT INTO ${quote(table)} (${fields.map(f => quote(this.column(table, f))).join(",")}) VALUES (${fields.map(() => "?").join(",")})`)
        .run(...fields.map(f => jsonEncode(table, f, value[f])));
      this.afterMutation(table, null, value);
      return value;
    };
    const transaction = db.transaction(() => {
      switch (name) {
        case "forgecy_delete_offer": {
          const offer=db.prepare("SELECT * FROM offers WHERE id=? AND client_id=?").get(a.p_offer_id,a.p_client_id) as Record<string,unknown>|undefined;
          if(!client(a.p_client_id)||!offer)throw new Error("Offerta non trovata");
          const campaigns=db.prepare("UPDATE campaigns SET offer_id=NULL,updated_at=? WHERE client_id=? AND offer_id=?").run(time,a.p_client_id,a.p_offer_id).changes;
          const contents=db.prepare("UPDATE contents SET offer_id=NULL,offer_version=NULL,updated_at=? WHERE client_id=? AND offer_id=?").run(time,a.p_client_id,a.p_offer_id).changes;
          db.prepare("DELETE FROM offers WHERE id=? AND client_id=?").run(a.p_offer_id,a.p_client_id);
          this.afterMutation("offers",offer,null);
          return {id:offer.id,campaignsDetached:campaigns,contentsDetached:contents};
        }
        case "forgecy_reserve_website_crawl": {
          if (!client(a.p_client_id)) throw new Error("Cliente non autorizzato");
          const host = String(a.p_hostname || ""); const pages = Number(a.p_page_budget);
          if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host) || !host.includes(".") || host.includes("..") || pages < 1 || pages > 100) throw new Error("Richiesta di acquisizione non valida");
          const fifteen = new Date(Date.now() - 15 * 60_000).toISOString(); const day = new Date(Date.now() - 86_400_000).toISOString();
          const recent = Number((db.prepare("SELECT count(*) n FROM website_crawl_requests WHERE client_id=? AND requested_at>? ").get(a.p_client_id, fifteen) as { n: number } | undefined)?.n || 0);
          const own = db.prepare("SELECT count(*) n,coalesce(sum(page_budget),0) pages FROM website_crawl_requests WHERE requested_by=? AND requested_at>? ").get(LOCAL_OWNER_ID, day) as { n: number; pages: number };
          const mine = Number((db.prepare("SELECT coalesce(sum(page_budget),0) n FROM website_crawl_requests WHERE client_id=? AND requested_at>? ").get(a.p_client_id, day) as { n: number } | undefined)?.n || 0);
          if (recent >= 2) throw new Error("Attendi prima di avviare una nuova analisi del sito");
          if (mine + pages > 200 || own.n >= 30 || own.pages + pages > 600) throw new Error("Budget giornaliero di acquisizione esaurito");
          return insert("website_crawl_requests", { client_id: a.p_client_id, requested_by: LOCAL_OWNER_ID, hostname: host, page_budget: pages }).id;
        }
        case "forgecy_enqueue_ai_job": {
          const c = client(a.p_client_id); if (!c) throw new Error("Cliente non autorizzato");
          const kind = String(a.p_kind); const payload = (a.p_payload || {}) as Record<string, unknown>;
          if (!("dossier strategy mission".split(" ").includes(kind)) || JSON.stringify(payload).length > 12_000) throw new Error("Lavoro non valido");
          if ((kind === "dossier" || kind === "strategy") && Object.keys(payload).length) throw new Error("Parametri non validi");
          if (kind === "mission" && (String(payload.request || "").trim().length < 8 || String(payload.request || "").length > 3000 || String(payload.period || "").length > 80)) throw new Error("Parametri missione non validi");
          return insert("ai_jobs", { client_id: a.p_client_id, requested_by: LOCAL_OWNER_ID, kind, payload, status: "queued", result: {}, run_after: time }).id;
        }
        case "forgecy_cancel_ai_job": {
          const result = db.prepare("UPDATE ai_jobs SET status='cancelled',finished_at=?,updated_at=? WHERE id=? AND status='queued' AND requested_by=?").run(time, time, a.p_job_id, LOCAL_OWNER_ID);
          return result.changes === 1;
        }
        case "forgecy_claim_ai_job": {
          db.prepare("UPDATE ai_jobs SET status='failed',finished_at=?,locked_until=NULL,lease_token=NULL,updated_at=?,error='Il worker non ha completato il lavoro entro il limite' WHERE status='running' AND locked_until<=? AND attempts>=max_attempts").run(time, time, time);
          db.prepare("UPDATE ai_jobs SET status='queued',run_after=?,locked_until=NULL,lease_token=NULL,updated_at=?,error='Tentativo interrotto: nuova esecuzione' WHERE status='running' AND locked_until<=? AND attempts<max_attempts").run(time, time, time);
          const candidate = db.prepare("SELECT id FROM ai_jobs WHERE status='queued' AND run_after<=? ORDER BY created_at,id LIMIT 1").get(time) as { id: string } | undefined;
          if (!candidate) return [];
          db.prepare("UPDATE ai_jobs SET status='running',attempts=attempts+1,lease_token=?,locked_until=?,updated_at=?,error=NULL WHERE id=?").run(randomUUID(), new Date(Date.now() + 150_000).toISOString(), time, candidate.id);
          return rows("SELECT * FROM ai_jobs WHERE id=?", candidate.id).map(row => decode("ai_jobs", row));
        }
        case "forgecy_heartbeat_ai_job": {
          return db.prepare("UPDATE ai_jobs SET locked_until=?,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND locked_until>? ")
            .run(new Date(Date.now() + 150_000).toISOString(), time, a.p_job_id, a.p_lease_token, time).changes === 1;
        }
        case "forgecy_complete_ai_job": {
          const result = JSON.stringify(a.p_result || {}); if (Buffer.byteLength(result) > 12_000) throw new Error("Risultato troppo grande");
          return db.prepare("UPDATE ai_jobs SET status='succeeded',result=?,error=NULL,locked_until=NULL,lease_token=NULL,finished_at=?,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND locked_until>? ")
            .run(result, time, time, a.p_job_id, a.p_lease_token, time).changes === 1;
        }
        case "forgecy_fail_ai_job": {
          const row = db.prepare("SELECT attempts,max_attempts FROM ai_jobs WHERE id=? AND status='running' AND lease_token=? AND locked_until>? ").get(a.p_job_id, a.p_lease_token, time) as { attempts: number; max_attempts: number } | undefined;
          if (!row) return false;
          const retry = a.p_retry === true && row.attempts < row.max_attempts;
          const runAfter = retry ? new Date(Math.max(Date.now() + 1000, Math.min(Date.parse(String(a.p_run_after || time)), Date.now() + 1_200_000))).toISOString() : null;
          return db.prepare("UPDATE ai_jobs SET status=?,run_after=coalesce(?,run_after),error=?,locked_until=NULL,lease_token=NULL,finished_at=?,updated_at=? WHERE id=? AND lease_token=?")
            .run(retry ? "queued" : "failed", runAfter, String(a.p_error || "Errore sconosciuto").slice(0, 400), retry ? null : time, time, a.p_job_id, a.p_lease_token).changes === 1;
        }
        case "approve_forgecy_dossier": {
          const c = client(a.p_client_id); const dossier = db.prepare("SELECT * FROM dossiers WHERE id=? AND client_id=?").get(a.p_dossier_id, a.p_client_id) as Record<string, unknown> | undefined;
          if (!c || !dossier || dossier.status !== "draft" || Number(dossier.knowledge_revision) !== Number(c.knowledge_revision)) throw new Error("Dossier non aggiornato: ricrea la bozza");
          const newer = db.prepare("SELECT 1 FROM dossiers WHERE client_id=? AND version>? ").get(a.p_client_id, dossier.version); if (newer) throw new Error("Esiste una versione più recente");
          db.prepare("UPDATE dossiers SET status='stale' WHERE client_id=? AND id<>? AND status='approved'").run(a.p_client_id, a.p_dossier_id);
          db.prepare("UPDATE dossiers SET status='approved',approved_at=? WHERE id=?").run(time, a.p_dossier_id);
          insert("audit_events", { client_id: a.p_client_id, actor_id: LOCAL_OWNER_ID, action: "dossier_approved", target_id: a.p_dossier_id, details: {} });
          return a.p_dossier_id;
        }
        case "approve_forgecy_strategy": {
          const c = client(a.p_client_id); const strategy = db.prepare("SELECT * FROM strategies WHERE id=? AND client_id=?").get(a.p_strategy_id, a.p_client_id) as Record<string, unknown> | undefined;
          if (!c || !strategy || strategy.status !== "draft" || Number(strategy.knowledge_revision) !== Number(c.knowledge_revision)) throw new Error("Strategia non aggiornata o non approvabile");
          const newer = db.prepare("SELECT 1 FROM strategies WHERE client_id=? AND version>? ").get(a.p_client_id, strategy.version);
          const dossier = db.prepare("SELECT 1 FROM dossiers WHERE id=? AND client_id=? AND status='approved' AND knowledge_revision=?").get(strategy.dossier_id, a.p_client_id, c.knowledge_revision);
          if (newer || !dossier) throw new Error("Approva un dossier attuale e verifica la strategia");
          db.prepare("UPDATE strategies SET status='stale' WHERE client_id=? AND id<>? AND status='approved'").run(a.p_client_id, a.p_strategy_id);
          db.prepare("UPDATE strategies SET status='approved',approved_at=? WHERE id=?").run(time, a.p_strategy_id);
          insert("audit_events", { client_id: a.p_client_id, actor_id: LOCAL_OWNER_ID, action: "strategy_approved", target_id: a.p_strategy_id, details: {} });
          return a.p_strategy_id;
        }
        case "approve_forgecy_mission": {
          const c = client(a.p_client_id); const mission = db.prepare("SELECT * FROM missions WHERE id=? AND client_id=?").get(a.p_mission_id, a.p_client_id) as Record<string, unknown> | undefined;
          if (!c || !mission || mission.status !== "proposed" || mission.proposed_action !== "create_campaign") throw new Error("Proposta inesistente o già elaborata");
          const dossier = db.prepare("SELECT status,knowledge_revision FROM dossiers WHERE client_id=? ORDER BY version DESC LIMIT 1").get(a.p_client_id) as { status: string; knowledge_revision: number } | undefined;
          const strategy = db.prepare("SELECT 1 FROM strategies WHERE client_id=? AND status='approved' AND knowledge_revision=?").get(a.p_client_id, c.knowledge_revision);
          if (dossier?.status !== "approved" || Number(dossier.knowledge_revision) !== Number(c.knowledge_revision) || !strategy) throw new Error("Dossier e strategia aggiornati e approvati richiesti");
          const payload = JSON.parse(String(mission.payload || "{}")); const campaignInput = payload.campaign; const pieces = payload.contents;
          if (!campaignInput || !Array.isArray(pieces) || pieces.length < 1 || pieces.length > 20) throw new Error("Payload della proposta non valido");
          const offerId = campaignInput.offer_id || null;
          let offerVersion: number | null = null;
          if (offerId) {
            const offer = db.prepare("SELECT version FROM offers WHERE id=? AND client_id=? AND status='verified'").get(offerId, a.p_client_id) as { version: number } | undefined;
            if (!offer) throw new Error("Offerta non verificata"); offerVersion = offer.version;
          }
          const campaign = insert("campaigns", { client_id: a.p_client_id, offer_id: offerId, title: String(campaignInput.title || "").slice(0, 180), objective: String(campaignInput.objective || "").slice(0, 3000), period: String(campaignInput.period || "").slice(0, 80), strategy: campaignInput.strategy || {}, status: "draft" });
          for (const piece of pieces) insert("contents", { client_id: a.p_client_id, campaign_id: campaign.id, offer_id: offerId, title: String(piece.title || "").slice(0, 240), caption: String(piece.caption || "").slice(0, 12_000), channel: piece.channel, format: piece.format, slides: piece.slides || [], offer_version: offerVersion, status: "draft" });
          db.prepare("UPDATE missions SET status='approved',updated_at=? WHERE id=?").run(time, mission.id);
          insert("audit_events", { client_id: a.p_client_id, actor_id: LOCAL_OWNER_ID, action: "mission_approved", target_id: campaign.id, details: { mission_id: mission.id } });
          return campaign.id;
        }
        case "forgecy_search_sources":
        case "forgecy_search_client_sources":
        case "forgecy_worker_search_client_sources": {
          if (!client(a.p_client_id) || (a.p_requested_by && a.p_requested_by !== LOCAL_OWNER_ID)) throw new Error("Cliente non autorizzato");
          const query = String(a.p_query || "").trim(); if (query.length < 2 || query.length > 200) throw new Error("Ricerca non valida");
          const terms = [...new Set(query.toLocaleLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 8);
          if (!terms.length) return [];
          const match = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(" OR ");
          const max = Math.min(20, Math.max(1, Number(a.p_limit || 8)));
          if (name === "forgecy_search_sources") {
            return rows(`SELECT s.id,s.title,s.kind,s.url,c.section_title,substr(c.body,1,1500) excerpt,
                (-bm25(source_chunk_fts,0,0,4.0,1.0)) relevance,s.captured_at
              FROM source_chunk_fts
              JOIN source_chunks c ON c.id=source_chunk_fts.chunk_id
              JOIN sources s ON s.id=c.source_id AND s.client_id=c.client_id
              WHERE source_chunk_fts MATCH ? AND s.client_id=? AND s.status='ready'
              ORDER BY bm25(source_chunk_fts,0,0,4.0,1.0),s.captured_at DESC LIMIT ?`, match, a.p_client_id, max);
          }
          const results = rows(`SELECT c.source_id,s.title source_title,s.url source_url,c.ordinal chunk_ordinal,c.section_title,c.body excerpt,(-bm25(source_chunk_fts,0,0,4.0,1.0)) relevance FROM source_chunk_fts JOIN source_chunks c ON c.id=source_chunk_fts.chunk_id JOIN sources s ON s.id=c.source_id AND s.client_id=c.client_id WHERE source_chunk_fts MATCH ? AND s.client_id=? AND s.status='ready' ORDER BY bm25(source_chunk_fts,0,0,4.0,1.0),c.ordinal LIMIT ?`, match, a.p_client_id, max);
          return results;
        }
        case "forgecy_client_ai_usage_summary": {
          const days = Math.min(90, Math.max(1, Number(a.p_days || 30)));
          return rows("SELECT provider,operation,model,count(*) calls,sum(CASE WHEN usage_status='reported' THEN 1 ELSE 0 END) token_reported_calls,sum(CASE WHEN reported_cost_usd IS NOT NULL THEN 1 ELSE 0 END) cost_reported_calls,coalesce(sum(prompt_tokens),0) prompt_tokens,coalesce(sum(completion_tokens),0) completion_tokens,sum(reported_cost_usd) reported_cost_usd FROM ai_provider_usage WHERE client_id=? AND requested_by=? AND created_at>=? GROUP BY provider,operation,model ORDER BY reported_cost_usd DESC,provider,operation,model LIMIT 100", a.p_client_id, LOCAL_OWNER_ID, new Date(Date.now() - days * 86_400_000).toISOString());
        }
        default: throw new Error(`Operazione locale non implementata: ${name}`);
      }
    });
    return transaction();
  }
}

export const localDb = () => new LocalDatabase();

import { LocalStorageBucket } from "./storage";
