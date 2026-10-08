/**
 * The Verify and Conflicts steps of an import (spec page 68): checks the package (manifest,
 * checksums, Forgecy version) and lists what clashes with this installation. Writes nothing.
 */
import {
  templateConflictId,
  type ClientImportConflict,
  type ClientImportProblem,
  type ClientImportResolved,
} from "@forgecy/core";
import { migrationStatus, sql, type ClientImportReport, type Database } from "@forgecy/db";
import { clientTables, TABLE_AREAS } from "./graph";
import {
  openClientPackage,
  packageManifestSchema,
  packagePeopleSchema,
  type ClientPackage,
} from "./package";
import { assertPackageData, UnsafePackageError } from "./safety";

export interface PackageVerification {
  problems: ClientImportProblem[];
  report: ClientImportReport | null;
  conflicts: ClientImportConflict[];
  resolved: ClientImportResolved[];
}

type Manifest = ReturnType<typeof packageManifestSchema.parse>;

/** First free slug among `base`, `base-2`, `base-3`… */
export async function freeClientSlug(db: Database, base: string): Promise<string> {
  const res = await db.execute<{ slug: string }>(
    sql`select slug from clients where slug = ${base} or slug like ${`${base}-%`}`,
  );
  const taken = new Set(res.rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function checksums(pkg: ClientPackage, manifest: Manifest): Promise<boolean> {
  for (const [table, info] of Object.entries(manifest.tables)) {
    const name = `data/${table}.json`;
    if (!pkg.has(name) || (await pkg.sha256(name)) !== info.sha256) return false;
  }
  for (const f of manifest.files) {
    const name = `files/${f.key}`;
    if (!pkg.has(name) || (await pkg.sha256(name)) !== f.sha256) return false;
  }
  return true;
}

async function conflictsOf(
  db: Database,
  pkg: ClientPackage,
  manifest: Manifest,
): Promise<Pick<PackageVerification, "conflicts" | "resolved">> {
  const conflicts: ClientImportConflict[] = [];
  const resolved: ClientImportResolved[] = [];

  const { slug, name } = manifest.client;
  const same = await db.execute<{ id: string; name: string; slug: string }>(
    sql`select id, name, slug from clients where slug = ${slug} or lower(name) = lower(${name})
        order by (slug = ${slug}) desc limit 1`,
  );
  const existing = same.rows[0];
  if (existing)
    conflicts.push({
      kind: "client",
      name,
      slug,
      existingId: existing.id,
      existingName: existing.name,
      proposedSlug: await freeClientSlug(db, slug),
    });

  if (pkg.has("data/templates.json")) {
    const rows = JSON.parse(await pkg.text("data/templates.json")) as {
      key: string;
      version: string;
      name: string;
    }[];
    for (const t of rows) {
      const res = await db.execute<{ version: string }>(
        sql`select version from templates where key = ${t.key} order by created_at desc`,
      );
      const versions = res.rows.map((r) => r.version);
      if (versions.includes(t.version))
        resolved.push({ kind: "templateReused", key: t.key, version: t.version });
      else if (versions.length)
        conflicts.push({
          kind: "template",
          key: t.key,
          version: t.version,
          name: t.name,
          existingVersions: versions,
        });
    }
  }

  if (pkg.has("people.json")) {
    const people = packagePeopleSchema.parse(JSON.parse(await pkg.text("people.json")));
    const emails = people.map((p) => p.email.toLowerCase());
    const found = emails.length
      ? await db.execute<{ email: string }>(
          sql`select lower(email) as email from users where lower(email) = any(${`{${emails.map((e) => JSON.stringify(e)).join(",")}}`}::text[])`,
        )
      : { rows: [] };
    const here = new Set(found.rows.map((r) => r.email));
    for (const p of people)
      resolved.push({
        kind: here.has(p.email.toLowerCase()) ? "authorMatched" : "authorMissing",
        name: p.name,
        email: p.email,
      });
  }
  // Same order every time, so the choices keep their place on reload.
  conflicts.sort((a, b) =>
    a.kind === b.kind
      ? a.kind === "template" && b.kind === "template"
        ? templateConflictId(a.key, a.version).localeCompare(templateConflictId(b.key, b.version))
        : 0
      : a.kind === "client"
        ? -1
        : 1,
  );
  return { conflicts, resolved };
}

/** Reads and checks the package at `file`. Problems block the import; conflicts need a choice. */
export async function verifyClientPackage(
  db: Database,
  file: string,
  bytes: number,
): Promise<PackageVerification> {
  const fail = (p: ClientImportProblem, report: ClientImportReport | null = null) => ({
    problems: [p],
    report,
    conflicts: [],
    resolved: [],
  });
  let pkg: ClientPackage;
  try {
    pkg = await openClientPackage(file);
  } catch {
    return fail("unreadable");
  }
  try {
    if (!pkg.has("manifest.json")) return fail("format");
    let manifest: Manifest;
    try {
      manifest = packageManifestSchema.parse(JSON.parse(await pkg.text("manifest.json")));
    } catch {
      return fail("format");
    }
    const counts: Record<string, number> = {};
    for (const [table, info] of Object.entries(manifest.tables)) {
      const area = TABLE_AREAS[table];
      if (area && area !== "client") counts[area] = (counts[area] ?? 0) + info.rows;
    }
    counts.files = manifest.files.length;
    const report: ClientImportReport = {
      format: manifest.format,
      exportedAt: manifest.exportedAt,
      schemaMigrations: manifest.schema.migrations,
      client: { name: manifest.client.name, slug: manifest.client.slug },
      areas: manifest.areas,
      counts,
      bytes,
    };
    const installed = await migrationStatus(db);
    if (manifest.schema.migrations > installed.applied) return fail("newerVersion", report);
    const known = new Set(clientTables().map((t) => t.name));
    if (Object.entries(manifest.tables).some(([t, info]) => info.rows > 0 && !known.has(t)))
      return fail("unknownTable", report);
    if (!(await checksums(pkg, manifest))) return fail("checksum", report);
    try {
      await assertPackageData(pkg, manifest);
    } catch (err) {
      if (err instanceof UnsafePackageError) return fail("unsafe", report);
      throw err;
    }
    return { problems: [], report, ...(await conflictsOf(db, pkg, manifest)) };
  } finally {
    pkg.close();
  }
}
