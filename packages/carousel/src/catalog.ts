import { type Actor, ForgecyError, assertCan } from "@forgecy/core";
import { type Database, and, desc, eq, inArray, recordAuditEvent, templates } from "@forgecy/db";
import { type StorageDriver, contentKey, sha256 } from "@forgecy/files";
import { type Zippable, zipSync } from "fflate";
import { type TemplateSource, unzipTemplatePackage } from "./node";
import { type TemplatePackage, packageFromFiles } from "./package";
import { type ValidationReport, validateTemplatePackage } from "./validate";

/**
 * Template catalog in the database (spec pages 35–37). Each version is a row; its
 * package is a ZIP in storage. Import creates or replaces a draft, then the worker
 * runs the render checks; a version can be published only when everything passed.
 */
export type TemplateRow = typeof templates.$inferSelect;
export type TemplateStatus = "draft" | "in_review" | "published" | "archived";

export const templateStatusLabels: Record<TemplateStatus, string> = {
  draft: "Bozza",
  in_review: "In revisione",
  published: "Pubblicato",
  archived: "Archiviato",
};

/** Stored validation: the report plus whether the worker already ran the render checks. */
export type StoredValidation = Pick<ValidationReport, "ok" | "checks" | "issues"> & {
  rendered: boolean;
  checkedAt?: string;
};

export function storedValidation(row: Pick<TemplateRow, "validation">): StoredValidation {
  const v = row.validation as Partial<StoredValidation>;
  return {
    ok: Boolean(v.ok),
    checks: v.checks ?? [],
    issues: v.issues ?? [],
    rendered: Boolean(v.rendered),
    ...(v.checkedAt ? { checkedAt: v.checkedAt } : {}),
  };
}

/** Ready to publish: static checks and the worker's render checks both passed. */
export function isPublishable(row: Pick<TemplateRow, "validation">): boolean {
  const v = storedValidation(row);
  return v.ok && v.rendered;
}

/** "1.10.0" > "1.9.3" */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Canonical ZIP of a package: sorted entries, fixed dates, so the same files give the same hash. */
export function packTemplateZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const mtime = new Date(2000, 0, 1);
  const z: Zippable = {};
  for (const name of [...files.keys()].sort()) z[name] = [files.get(name)!, { level: 6, mtime }];
  return zipSync(z, { mtime });
}

export interface ImportTemplateInput {
  db: Database;
  storage: StorageDriver;
  actor: Actor;
  files: ReadonlyMap<string, Uint8Array>;
  origin?: "agency" | "system";
}

export interface ImportTemplateResult {
  row: TemplateRow;
  report: ValidationReport;
  /** A draft with the same key and version existed and its package was replaced. */
  replaced: boolean;
}

/**
 * Import a package as a draft. Re-importing the same version replaces the draft's
 * package (page 37 «Carica nuovo pacchetto»); a version already in review, published or
 * archived is never overwritten.
 */
export async function importTemplate(input: ImportTemplateInput): Promise<ImportTemplateResult> {
  const { db, storage, actor, files } = input;
  assertCan(actor, "templates.manage");
  const report = validateTemplatePackage(files);
  const m = report.manifest;
  if (!m)
    throw new ForgecyError("validation", "template.json non valido", { issues: report.issues });

  const zip = packTemplateZip(files);
  const hash = sha256(zip);
  const key = contentKey({ scope: "templates", sha256: hash, ext: "zip" });
  if (!(await storage.exists(key)))
    await storage.put(key, zip, { contentType: "application/zip", contentLength: zip.length });

  const existing = await db.query.templates.findFirst({
    where: and(eq(templates.key, m.id), eq(templates.version, m.version)),
  });
  if (existing && existing.status !== "draft")
    throw new ForgecyError(
      "conflict",
      `La versione ${m.version} di «${m.name}» è ${templateStatusLabels[existing.status as TemplateStatus].toLowerCase()}: aumenta "version" in template.json.`,
    );

  const validation: StoredValidation = {
    ok: report.ok,
    checks: report.checks,
    issues: report.issues,
    rendered: false,
  };
  const values = {
    key: m.id,
    version: m.version,
    name: m.name,
    kind: m.kind,
    channel: m.channel,
    format: m.format,
    origin: input.origin ?? "agency",
    manifest: m as unknown as Record<string, unknown>,
    packageKey: key,
    packageSha256: hash,
    packageSize: zip.length,
    validation: validation as unknown as Record<string, unknown>,
  };
  const row = await db.transaction(async (tx) => {
    const [saved] = existing
      ? await tx.update(templates).set(values).where(eq(templates.id, existing.id)).returning()
      : await tx
          .insert(templates)
          .values({ ...values, createdBy: actor.type === "user" ? actor.id : null })
          .returning();
    await recordAuditEvent(tx, {
      actor,
      action: existing ? "template.package_replaced" : "template.imported",
      entity: "template",
      entityId: saved!.id,
      meta: { key: m.id, version: m.version, sha256: hash, issues: report.issues.length },
    });
    return saved!;
  });
  return { row, report, replaced: Boolean(existing) };
}

/** Save the worker's full report (static + render checks) on the row. */
export async function saveTemplateValidation(
  db: Database,
  id: string,
  report: ValidationReport,
): Promise<void> {
  const validation: StoredValidation = {
    ok: report.ok,
    checks: report.checks,
    issues: report.issues,
    rendered: true,
    checkedAt: new Date().toISOString(),
  };
  await db
    .update(templates)
    .set({ validation: validation as unknown as Record<string, unknown> })
    .where(eq(templates.id, id));
}

const TRANSITIONS: Record<TemplateStatus, TemplateStatus[]> = {
  draft: ["in_review", "published"],
  in_review: ["draft", "published"],
  published: ["archived"],
  archived: ["published"],
};

export interface TransitionInput {
  db: Database;
  actor: Actor;
  id: string;
  to: TemplateStatus;
  /** Version notes: required to send for review or publish. */
  notes?: string;
}

/** Move a template version through its lifecycle; agents can never do it (`templates.manage`). */
export async function transitionTemplate(input: TransitionInput): Promise<TemplateRow> {
  const { db, actor, id, to } = input;
  assertCan(actor, "templates.manage");
  const row = await db.query.templates.findFirst({ where: eq(templates.id, id) });
  if (!row) throw new ForgecyError("not_found", "Template non trovato");
  const from = row.status as TemplateStatus;
  if (!TRANSITIONS[from]?.includes(to))
    throw new ForgecyError(
      "conflict",
      `Da «${templateStatusLabels[from]}» non si può passare a «${templateStatusLabels[to]}»`,
    );
  const notes = input.notes?.trim() ?? "";
  if ((to === "in_review" || (to === "published" && from !== "archived")) && notes.length < 3)
    throw new ForgecyError("validation", "Scrivi cosa cambia in questa versione");
  if ((to === "in_review" || to === "published") && !isPublishable(row))
    throw new ForgecyError("validation", "La validazione del template non è superata");

  const now = new Date();
  const set: Partial<typeof templates.$inferInsert> = { status: to };
  if (notes) set.versionNotes = notes;
  if (to === "in_review") set.submittedAt = now;
  if (to === "published") {
    set.publishedAt = now;
    set.publishedBy = actor.type === "user" ? actor.id : null;
    set.archivedAt = null;
  }
  if (to === "archived") set.archivedAt = now;
  return db.transaction(async (tx) => {
    const [saved] = await tx.update(templates).set(set).where(eq(templates.id, id)).returning();
    await recordAuditEvent(tx, {
      actor,
      action: `template.${to}`,
      entity: "template",
      entityId: id,
      meta: { key: row.key, version: row.version, from, ...(notes ? { notes } : {}) },
    });
    return saved!;
  });
}

/** Every version, newest first within each key. */
export async function listTemplates(db: Database): Promise<TemplateRow[]> {
  const rows = await db.select().from(templates).orderBy(templates.name, desc(templates.createdAt));
  return rows.sort((a, b) => a.name.localeCompare(b.name) || compareVersions(b.version, a.version));
}

export async function getTemplateRow(db: Database, id: string): Promise<TemplateRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return db.query.templates.findFirst({ where: eq(templates.id, id) });
}

const cache = new Map<string, TemplatePackage>();

/** The package of a row, read from storage once per hash. */
export async function loadTemplatePackage(
  storage: StorageDriver,
  row: Pick<TemplateRow, "packageKey" | "packageSha256">,
): Promise<TemplatePackage> {
  const hit = cache.get(row.packageSha256);
  if (hit) return hit;
  const chunks: Uint8Array[] = [];
  for await (const c of await storage.get(row.packageKey)) chunks.push(c as Uint8Array);
  const bytes = new Uint8Array(Buffer.concat(chunks));
  if (sha256(bytes) !== row.packageSha256)
    throw new ForgecyError("conflict", `Pacchetto del template alterato: ${row.packageKey}`);
  const pkg = packageFromFiles(unzipTemplatePackage(bytes));
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(row.packageSha256, pkg);
  return pkg;
}

/**
 * Templates for exports and editors: without a version, the newest published one;
 * with a version (pinned by a carousel), that version as long as it was published
 * (archived versions keep exporting the carousels that use them).
 */
export function dbTemplateSource(deps: { db: Database; storage: StorageDriver }): TemplateSource {
  return {
    async get(key, version) {
      const rows = await deps.db
        .select()
        .from(templates)
        .where(
          and(
            eq(templates.key, key),
            version ? eq(templates.version, version) : undefined,
            inArray(templates.status, version ? ["published", "archived"] : ["published"]),
          ),
        );
      const row = rows.sort((a, b) => compareVersions(b.version, a.version))[0];
      return row ? loadTemplatePackage(deps.storage, row) : undefined;
    },
  };
}
