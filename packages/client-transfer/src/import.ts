/**
 * Writes a verified package into this installation (spec page 68). Every id gets a new
 * value (storage keys and ids inside JSON follow), people are matched by email, and
 * all rows go in one transaction: a failure leaves no partial data. Files are copied
 * first and removed again if the transaction fails.
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  DEFAULT_AI_POLICY_KEY,
  resolveDefaultAiPolicy,
  templateConflictId,
  type ClientImportChoices,
  type ClientTransferArea,
} from "@forgecy/core";
import { appSettings, eq, sql, type Database } from "@forgecy/db";
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
import { rewriteTemplateRefs, templateReuse } from "./templates";
import {
  applyImportTrust,
  assertTrustRules,
  unreferencedExportFiles,
  type ExistingConsent,
} from "./trust";

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

/**
 * What the trust rules need from this installation: what an Admin gave new clients, and, when a
 * client is replaced, its slug and its current AI consent. Read once to prepare the rows and
 * again inside the import transaction (locking the client that is about to be replaced), so a
 * policy or provider change made in between is not overwritten.
 */
async function readTrustInputs(
  q: Pick<Database, "execute" | "select">,
  replaceClientId: string | undefined,
  lock: boolean,
): Promise<{ defaultAiPolicy: string; slug: string | null; existing: ExistingConsent | null }> {
  const [setting] = await q
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, DEFAULT_AI_POLICY_KEY));
  const defaultAiPolicy = resolveDefaultAiPolicy(setting?.value);
  if (!replaceClientId) return { defaultAiPolicy, slug: null, existing: null };
  const res = await q.execute<{
    slug: string;
    ai_policy: string;
    approved_providers: string[];
    sendable_assets: string[];
  }>(
    sql`select slug, ai_policy, to_json(approved_providers) as approved_providers,
               to_json(sendable_assets) as sendable_assets
        from clients where id = ${replaceClientId} ${lock ? sql`for update` : sql``}`,
  );
  const row = res.rows[0];
  if (!row) throw new Error("The client to replace no longer exists");
  return {
    defaultAiPolicy,
    slug: row.slug,
    existing: {
      aiPolicy: row.ai_policy,
      approvedProviders: row.approved_providers,
      sendableAssets: row.sendable_assets,
    },
  };
}

export async function importClientPackage(
  deps: { db: Database; storage: StorageDriver },
  file: string,
  plan: ImportPlan,
): Promise<ImportOutcome> {
  const { db, storage } = deps;
  assertTrustRules(); // a schema change without a decision about it stops the import, not the app
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
    // What the replaced client allows its AI to do stays as it is, and a new client never gets
    // more than the installation's default: a package cannot widen either.
    const inputs = await readTrustInputs(db, plan.replaceClientId, false);
    if (plan.replaceClientId) {
      clientId = plan.replaceClientId;
      slug = inputs.slug!;
    } else {
      if (plan.choices.client.mode !== "new") throw new Error("Replacement without a client");
      clientId = randomUUID();
      slug = plan.choices.client.slug;
    }
    idMap.set(manifest.client.id, clientId);
    const trust = {
      clientId,
      existing: inputs.existing,
      defaultAiPolicy: inputs.defaultAiPolicy,
    };

    // Templates already here are reused; a conflict follows the person's choice. Only agency
    // templates and the replaced client's own count: another client's private template is
    // never mapped in.
    const skipTemplates = new Set<string>();
    const versionRewrite = new Map<string, string>();
    // Templates are unique by key and version across the installation: one that collides with
    // another client's private template gets a free version instead of a database error.
    const renamedTemplates = new Map<string, string>();
    const packageTemplates = JSON.parse(raw.get("templates") ?? "[]") as Row[];
    for (const t of packageTemplates) {
      const key = String(t.key);
      const version = String(t.version);
      const all = await db.execute<{ id: string; version: string; client_id: string | null }>(
        sql`select id, version, client_id from templates where key = ${key} order by created_at desc`,
      );
      // The same decision Verify showed (templates.ts), with the person's choice.
      const decision = templateReuse(
        all.rows,
        version,
        plan.replaceClientId ?? null,
        plan.choices.templates[templateConflictId(key, version)],
        packageTemplates.filter((o) => o !== t && o.key === t.key).map((o) => String(o.version)),
      );
      if (decision.kind === "exact") {
        idMap.set(String(t.id), decision.row.id);
        skipTemplates.add(decision.row.id);
      } else if (decision.kind === "useExisting") {
        idMap.set(String(t.id), decision.row.id);
        skipTemplates.add(decision.row.id);
        versionRewrite.set(templateConflictId(key, version), decision.row.version);
      } else if (decision.version !== version) {
        renamedTemplates.set(idMap.get(String(t.id))!, decision.version);
        versionRewrite.set(templateConflictId(key, version), decision.version);
      }
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
    const droppedTexts: string[] = [];
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
      for (const parsed of mapped) {
        if (table.name === "templates" && skipTemplates.has(String(parsed.id))) continue;
        // After the checks, before anything is written: nothing arrives approved (trust.ts).
        const r = applyImportTrust(table.name, parsed, trust);
        if (!r) {
          droppedTexts.push(JSON.stringify(parsed));
          continue;
        }
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
        const renamed = table.name === "templates" ? renamedTemplates.get(String(r.id)) : undefined;
        if (renamed) {
          r.version = renamed;
          // The stored copy of template.json says the same as the row.
          if (r.manifest && typeof r.manifest === "object")
            r.manifest = { ...(r.manifest as Row), version: renamed };
        }
        // Every row that names a template by key and version (columns and JSON) follows a
        // rename or a reuse, or it would render with another client's private template.
        if (versionRewrite.size) Object.assign(r, rewriteTemplateRefs(r, versionRewrite));
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
    // A file that only a dropped export record pointed at has nothing to belong to.
    const orphaned = unreferencedExportFiles(
      manifest.files.map((f) => remapIds(f.key, idMap)),
      droppedTexts,
      prepared.map((p) => JSON.stringify(p.rows)),
    );
    const files = manifest.files.filter((f) => !orphaned.has(remapIds(f.key, idMap)));
    const written: string[] = [];
    try {
      await copyPackageFiles({ pkg, storage }, files, (k) => remapIds(k, idMap), written);

      await db.transaction(async (tx) => {
        // The consent rules read again, with the replaced client locked: an Admin may have
        // changed the policy or the approved providers while the rows were being prepared.
        const fresh = await readTrustInputs(tx, plan.replaceClientId, true);
        for (const p of prepared)
          if (p.table.name === "clients")
            p.rows = p.rows.map((r) => applyImportTrust("clients", r, { ...trust, ...fresh }) ?? r);
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

    const counts: ImportOutcome["counts"] = { files: files.length };
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
