/**
 * Writes a verified package into this installation (spec page 68). Every id gets a new
 * value (storage keys and ids inside JSON follow), people are matched by email, and
 * all rows go in one transaction: a failure leaves no partial data. Files are copied
 * first and removed again if the transaction fails.
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  templateConflictId,
  type ClientImportChoices,
  type ClientTransferArea,
} from "@forgecy/core";
import { sql, type Database } from "@forgecy/db";
import { contentTypeForKey, isValidKey, type StorageDriver } from "@forgecy/files";
import { clientTables, type ClientTable } from "./graph";
import {
  openClientPackage,
  packageManifestSchema,
  packagePeopleSchema,
  type ClientPackage,
} from "./package";
import {
  assertPackageData,
  assertPackageScoped,
  emptyOutsideRefs,
  remapIds,
  remapRows,
  UnsafePackageError,
  verifiedChunks,
} from "./safety";

type Row = Record<string, unknown>;

// Ids are lower-case canonical (assertPackageData refuses anything else), so lookups are exact.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BATCH = 500;

export interface ImportPlan {
  choices: ClientImportChoices;
  /** Replacement: the client whose data is replaced (keeps its id and slug). */
  replaceClientId?: string;
}

export interface ImportOutcome {
  clientId: string;
  slug: string;
  name: string;
  /** Rows written per area, plus `files`. */
  counts: Partial<Record<ClientTransferArea | "files", number>>;
  /** For the notification: “4 versions, 23 carousels, 2 audits”. */
  summary: { versions: number; carousels: number; audits: number };
}

interface Deferred {
  table: string;
  column: string;
  values: { id: string; v: unknown }[];
}

/**
 * Copies the package's files into storage under their new keys, each one checked against the
 * manifest's size and sha-256 as it streams. A driver may take the stream with a bare `pipe()`
 * (S3 does) and so cannot be relied on to stop at the first wrong byte: the verdict is read
 * here, after `put`, and a file that did not verify completely fails the import. Whatever was
 * written (also the bad file) is removed again before the error leaves.
 */
export async function copyPackageFiles(
  deps: { pkg: ClientPackage; storage: StorageDriver },
  files: readonly { key: string; bytes: number; sha256: string }[],
  keyOf: (packageKey: string) => string,
  written: string[],
): Promise<void> {
  const { pkg, storage } = deps;
  try {
    for (const f of files) {
      const key = keyOf(f.key);
      if (!isValidKey(key)) throw new Error(`Invalid storage key in package: ${f.key}`);
      // Keys are content-addressed or carry ids: one that exists already holds the same file.
      if (await storage.exists(key)) continue;
      // Recorded before the write so a half-written file is removed again on failure.
      written.push(key);
      let verified = false;
      let failure: unknown;
      const source = await pkg.stream(`files/${f.key}`);
      const body = Readable.from(
        (async function* () {
          try {
            for await (const chunk of verifiedChunks(source, f)) yield chunk;
            verified = true;
          } catch (err) {
            failure = err;
            throw err;
          }
        })(),
      );
      // The driver decides how to react to an error of the body; an uncaught 'error' event would
      // take the worker down, and the verdict is read below either way.
      body.on("error", () => {});
      try {
        await storage.put(key, body, {
          contentType: contentTypeForKey(key),
          contentLength: f.bytes,
        });
      } catch (err) {
        throw failure ?? err;
      }
      if (!verified) throw failure ?? new UnsafePackageError("a file does not match its checksum");
    }
  } catch (err) {
    for (const key of written) await storage.delete(key).catch(() => {});
    throw err;
  }
}

async function emailsToUsers(db: Database, emails: string[]): Promise<Map<string, string>> {
  if (!emails.length) return new Map();
  const res = await db.execute<{ id: string; email: string }>(
    sql`select id, lower(email) as email from users
        where lower(email) = any(${`{${emails.map((e) => JSON.stringify(e.toLowerCase())).join(",")}}`}::text[])`,
  );
  return new Map(res.rows.map((r) => [r.email, r.id]));
}

async function insertRows(
  tx: Pick<Database, "execute">,
  table: ClientTable,
  rows: Row[],
): Promise<void> {
  // Only the columns the package carries: a package from an older version gets the defaults.
  const present = new Set(rows.flatMap((r) => Object.keys(r)));
  const columns = table.columns.filter((c) => present.has(c));
  const list = sql.join(
    columns.map((c) => sql.identifier(c)),
    sql`, `,
  );
  const ident = sql.identifier(table.name);
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = JSON.stringify(rows.slice(i, i + BATCH));
    await tx.execute(
      sql`insert into ${ident} (${list}) select ${list} from json_populate_recordset(null::${ident}, ${chunk}::json)`,
    );
  }
}

export async function importClientPackage(
  deps: { db: Database; storage: StorageDriver },
  file: string,
  plan: ImportPlan,
): Promise<ImportOutcome> {
  const { db, storage } = deps;
  const pkg = await openClientPackage(file);
  try {
    const manifest = packageManifestSchema.parse(JSON.parse(await pkg.text("manifest.json")));
    await assertPackageData(pkg, manifest); // the Verify step may be long past: check again
    const people = pkg.has("people.json")
      ? packagePeopleSchema.parse(JSON.parse(await pkg.text("people.json")))
      : [];
    const byEmail = await emailsToUsers(
      db,
      people.map((p) => p.email),
    );
    const userMap = new Map(people.map((p) => [p.id, byEmail.get(p.email.toLowerCase()) ?? null]));

    const tables = clientTables().filter((t) => pkg.has(`data/${t.name}.json`));
    const position = new Map(clientTables().map((t, i) => [t.name, i]));
    const raw = new Map<string, string>();
    for (const t of tables) raw.set(t.name, await pkg.text(`data/${t.name}.json`));

    // New ids for every row of the package; the client keeps the replaced one's id.
    const idMap = new Map<string, string>();
    for (const text of raw.values())
      for (const r of JSON.parse(text) as Row[])
        if (typeof r.id === "string" && UUID.test(r.id)) idMap.set(r.id, randomUUID());
    let slug: string;
    let clientId: string;
    if (plan.replaceClientId) {
      const res = await db.execute<{ slug: string }>(
        sql`select slug from clients where id = ${plan.replaceClientId}`,
      );
      if (!res.rows[0]) throw new Error("The client to replace no longer exists");
      clientId = plan.replaceClientId;
      slug = res.rows[0].slug;
    } else {
      if (plan.choices.client.mode !== "new") throw new Error("Replacement without a client");
      clientId = randomUUID();
      slug = plan.choices.client.slug;
    }
    idMap.set(manifest.client.id, clientId);

    // Templates already here are reused; a conflict follows the person's choice.
    const skipTemplates = new Set<string>();
    const draftTemplates = new Set<string>();
    const versionRewrite = new Map<string, string>();
    for (const t of JSON.parse(raw.get("templates") ?? "[]") as Row[]) {
      const key = String(t.key);
      const version = String(t.version);
      const res = await db.execute<{ id: string; version: string }>(
        sql`select id, version from templates where key = ${key} order by created_at desc`,
      );
      const exact = res.rows.find((r) => r.version === version);
      const choice = plan.choices.templates[templateConflictId(key, version)];
      if (exact) {
        idMap.set(String(t.id), exact.id);
        skipTemplates.add(exact.id);
      } else if (res.rows.length && choice === "useExisting") {
        idMap.set(String(t.id), res.rows[0]!.id);
        skipTemplates.add(res.rows[0]!.id);
        versionRewrite.set(templateConflictId(key, version), res.rows[0]!.version);
      } else if (res.rows.length) draftTemplates.add(idMap.get(String(t.id))!);
    }
    // Ids that exist here after the remap, per table: the package's rows and the templates it reuses.
    const hereIds = new Map<string, Set<string>>();
    for (const t of tables)
      hereIds.set(
        t.name,
        new Set(
          (JSON.parse(raw.get(t.name)!) as Row[]).flatMap((r) => {
            const id = typeof r.id === "string" ? idMap.get(r.id) : undefined;
            return id ? [id] : [];
          }),
        ),
      );

    const final = {
      clientId,
      idsByTable: hereIds,
      areas: new Set(["client", ...tables.map((t) => t.area)]),
    };
    const prepared: { table: ClientTable; rows: Row[] }[] = [];
    const deferred: Deferred[] = [];
    for (const table of tables) {
      const forward = table.parents.filter(
        (p) => !p.notNull && (position.get(p.target) ?? 0) >= (position.get(table.name) ?? 0),
      );
      const stash = new Map(forward.map((f) => [f.column, [] as Deferred["values"]]));
      const rows: Row[] = [];
      // The same parsed form the checks read; then the checks run again on what will be written,
      // so an id that the remap could not rewrite can never reach the database.
      const mapped = remapRows(raw.get(table.name)!, idMap);
      assertPackageScoped([table], new Map([[table.name, mapped]]), final);
      for (const r of mapped) {
        // People: matched by email, else emptied; a row that needs a person who is not here is left out.
        let keep = true;
        for (const u of table.userColumns) {
          const v = r[u.column];
          if (typeof v !== "string") continue;
          const local = userMap.get(v) ?? null;
          if (local === null && u.notNull) keep = false;
          r[u.column] = local;
        }
        if (!keep) continue;
        for (const d of table.droppedColumns) if (!d.notNull) r[d.column] = null;
        // A job or an agency template of the other installation means nothing here.
        emptyOutsideRefs(table, r, hereIds);
        if (table.name === "clients") r.slug = slug;
        if (table.name === "templates") {
          if (skipTemplates.has(String(r.id))) continue;
          if (draftTemplates.has(String(r.id)))
            Object.assign(r, {
              status: "draft",
              submitted_at: null,
              published_at: null,
              published_by: null,
              archived_at: null,
            });
        }
        // Reviewers of the other installation do not exist here (spec: back to Draft).
        if (table.name === "contents" && r.status === "in_review") r.status = "draft";
        if (typeof r.template_key === "string" && typeof r.template_version === "string") {
          const to = versionRewrite.get(templateConflictId(r.template_key, r.template_version));
          if (to) r.template_version = to;
        }
        if (typeof r.id === "string")
          for (const f of forward)
            if (r[f.column] != null) {
              stash.get(f.column)!.push({ id: r.id, v: r[f.column] });
              r[f.column] = null;
            }
        rows.push(r);
      }
      for (const [column, values] of stash)
        if (values.length) deferred.push({ table: table.name, column, values });
      prepared.push({ table, rows });
    }

    // Files first: written under their new keys, removed again if the rows cannot be written.
    const written: string[] = [];
    try {
      await copyPackageFiles({ pkg, storage }, manifest.files, (k) => remapIds(k, idMap), written);

      await db.transaction(async (tx) => {
        let keepTemplates: string[] = [];
        if (plan.replaceClientId) {
          const own = await tx.execute<{ id: string }>(
            sql`select id from templates where client_id = ${clientId}`,
          );
          keepTemplates = own.rows.map((r) => r.id);
          await tx.execute(sql`delete from clients where id = ${clientId}`);
        }
        for (const { table, rows } of prepared) if (rows.length) await insertRows(tx, table, rows);
        for (const d of deferred) {
          const ident = sql.identifier(d.table);
          for (let i = 0; i < d.values.length; i += BATCH)
            await tx.execute(
              sql`update ${ident} t set ${sql.identifier(d.column)} = x.v
                  from json_to_recordset(${JSON.stringify(d.values.slice(i, i + BATCH))}::json) as x(id uuid, v uuid)
                  where t.id = x.id`,
            );
        }
        // The replaced client's own templates stay assigned to it.
        if (keepTemplates.length)
          await tx.execute(
            sql`update templates set client_id = ${clientId}
                where id = any(${`{${keepTemplates.join(",")}}`}::uuid[])`,
          );
      });
    } catch (err) {
      for (const key of written) await storage.delete(key).catch(() => {});
      throw err;
    }

    const counts: ImportOutcome["counts"] = { files: manifest.files.length };
    const rowsOf = (name: string) => prepared.find((p) => p.table.name === name)?.rows.length ?? 0;
    for (const { table, rows } of prepared)
      if (table.area !== "client" && rows.length)
        counts[table.area] = (counts[table.area] ?? 0) + rows.length;
    return {
      clientId,
      slug,
      name: manifest.client.name,
      counts,
      summary: {
        versions: rowsOf("brand_identity_versions"),
        carousels: rowsOf("contents"),
        audits: rowsOf("audits"),
      },
    };
  } finally {
    pkg.close();
  }
}
