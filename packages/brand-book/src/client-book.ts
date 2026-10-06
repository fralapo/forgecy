/**
 * Client-facing Brand Book flow (UX spec 15.3–15.4): a person builds a preview from
 * an approved Brand Identity version (draft, with the "Draft" watermark), any person
 * approves it (with a note when approving their own book), then the final PDF is
 * rendered. A new exported book supersedes the client's previous ones. Agents never
 * take part: every step needs a person.
 */
import { compareVersions } from "@forgecy/carousel/catalog";
import { loadBrand } from "@forgecy/content";
import { assertCan, PermissionDeniedError, type Actor, type Locale } from "@forgecy/core";
import {
  and,
  brandBookExports,
  brandIdentityVersions,
  eq,
  inArray,
  ne,
  sql,
  templates,
  type Database,
} from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import { enqueueJob, type JobQueues } from "@forgecy/jobs";
import { emptyBookSections } from "./book";
import { brandBookRenderJob } from "./jobs";
import { BRAND_BOOK_TEMPLATE_KEY, bookSections, type BookSection } from "./parts";
import type { BrandBookExportRow } from "./service";

/** Approving your own book needs a note (UXA-22). */
export const SELF_APPROVAL_NOTE_MIN = 10;

function person(actor: Actor): Extract<Actor, { type: "user" }> {
  if (actor.type !== "user") throw new PermissionDeniedError("approve", actor);
  return actor;
}

async function requireBook(db: Database, clientId: string, exportId: string) {
  const [row] = await db
    .select()
    .from(brandBookExports)
    .where(
      and(
        eq(brandBookExports.id, exportId),
        eq(brandBookExports.clientId, clientId),
        eq(brandBookExports.type, "client_book"),
      ),
    );
  if (!row) throw localizedError("not_found", "brand.book.errors.notFound");
  return row;
}

/** Latest published version of the "Brand Book" template, or null when none is published. */
export async function publishedBookTemplate(db: Database): Promise<string | null> {
  const rows = await db
    .select({ version: templates.version })
    .from(templates)
    .where(and(eq(templates.key, BRAND_BOOK_TEMPLATE_KEY), eq(templates.status, "published")));
  return (
    rows
      .map((r) => r.version)
      .sort(compareVersions)
      .at(-1) ?? null
  );
}

/** Sections with nothing to show, per approved version: the form leaves them out. */
export async function emptySectionsByVersion(
  db: Database,
  actor: Actor,
  input: { clientId: string; clientName: string; versionIds: readonly string[] },
): Promise<Map<string, BookSection[]>> {
  assertCan(actor, "view", input.clientId);
  const out = new Map<string, BookSection[]>();
  for (const versionId of input.versionIds) {
    const brand = await loadBrand(db, actor, { ...input, versionId });
    if (!brand) continue;
    out.set(
      versionId,
      emptyBookSections({
        clientName: input.clientName,
        agencyName: null,
        versionNumber: 0,
        date: new Date(0),
        language: "en",
        document: brand.identity.document,
        tokens: brand.identity.tokens,
        colors: brand.theme.colors,
      }),
    );
  }
  return out;
}

async function queueRender(
  deps: { db: Database; queues: JobQueues },
  actor: Extract<Actor, { type: "user" }>,
  row: BrandBookExportRow,
  final: boolean,
) {
  const job = await enqueueJob(deps.db, deps.queues, {
    kind: brandBookRenderJob,
    payload: { exportId: row.id, final },
    clientId: row.clientId,
    entity: "brand_book_export",
    entityId: row.id,
    createdBy: actor.id,
  });
  await deps.db
    .update(brandBookExports)
    .set({ jobId: job.id, updatedAt: new Date() })
    .where(eq(brandBookExports.id, row.id));
  return job;
}

/** BB-n with a draft preview of the chosen sections; the PDF is rendered by the worker. */
export async function createClientBook(
  deps: { db: Database; queues: JobQueues },
  actor: Actor,
  input: { clientId: string; versionId: string; sections: readonly string[]; language: Locale },
): Promise<BrandBookExportRow> {
  assertCan(actor, "reports.export", input.clientId);
  const user = person(actor);
  const { db } = deps;
  const sections = bookSections.filter((s) => input.sections.includes(s));
  if (!sections.length) throw localizedError("validation", "brand.book.errors.noSections");
  const [version] = await db
    .select({ id: brandIdentityVersions.id, number: brandIdentityVersions.number })
    .from(brandIdentityVersions)
    .where(
      and(
        eq(brandIdentityVersions.id, input.versionId),
        eq(brandIdentityVersions.clientId, input.clientId),
        inArray(brandIdentityVersions.status, ["published", "archived"]),
        sql`${brandIdentityVersions.publishedAt} is not null`,
      ),
    );
  if (!version) throw localizedError("validation", "brand.book.errors.noPublished");
  const templateVersion = await publishedBookTemplate(db);
  if (!templateVersion) throw localizedError("validation", "brand.book.errors.templateMissing");

  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`brand_book:${input.clientId}`}))`,
    );
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${brandBookExports.number}), 0)::int` })
      .from(brandBookExports)
      .where(eq(brandBookExports.clientId, input.clientId));
    const [created] = await tx
      .insert(brandBookExports)
      .values({
        clientId: input.clientId,
        number: (last?.n ?? 0) + 1,
        type: "client_book",
        status: "draft",
        brandVersionId: version.id,
        brandVersionNumber: version.number,
        templateKey: BRAND_BOOK_TEMPLATE_KEY,
        templateVersion,
        language: input.language,
        parts: [...sections],
        createdBy: user.id,
      })
      .returning();
    return created!;
  });
  await queueRender(deps, user, row, false);
  return row;
}

/** Renders the preview again (after a failure or a template update). */
export async function rerenderClientBook(
  deps: { db: Database; queues: JobQueues },
  actor: Actor,
  input: { clientId: string; exportId: string },
) {
  assertCan(actor, "reports.export", input.clientId);
  const user = person(actor);
  const row = await requireBook(deps.db, input.clientId, input.exportId);
  if (row.status !== "draft") throw localizedError("conflict", "brand.book.errors.notDraft");
  return queueRender(deps, user, row, false);
}

/**
 * Any person may approve the preview; approving your own book needs a note.
 * Only a rendered preview can be approved: the approver approves what they saw.
 */
export async function approveClientBook(
  db: Database,
  actor: Actor,
  input: { clientId: string; exportId: string; note?: string | null },
): Promise<BrandBookExportRow> {
  assertCan(actor, "approve", input.clientId);
  const user = person(actor);
  const row = await requireBook(db, input.clientId, input.exportId);
  if (row.status !== "draft") throw localizedError("conflict", "brand.book.errors.notDraft");
  if (!row.storageKey) throw localizedError("conflict", "brand.book.errors.notRendered");
  const note = input.note?.trim() || null;
  if (row.createdBy === user.id && (note?.length ?? 0) < SELF_APPROVAL_NOTE_MIN)
    throw localizedError("validation", "brand.book.errors.noteRequired", {
      min: SELF_APPROVAL_NOTE_MIN,
    });
  const [updated] = await db
    .update(brandBookExports)
    .set({
      status: "approved",
      approvedBy: user.id,
      approvedAt: new Date(),
      approvalNote: note,
      updatedAt: new Date(),
    })
    .where(and(eq(brandBookExports.id, row.id), eq(brandBookExports.status, "draft")))
    .returning();
  if (!updated) throw localizedError("conflict", "brand.book.errors.notDraft");
  return updated;
}

/** Final PDF of an approved book, without the watermark. */
export async function exportClientBook(
  deps: { db: Database; queues: JobQueues },
  actor: Actor,
  input: { clientId: string; exportId: string },
) {
  assertCan(actor, "reports.export", input.clientId);
  const user = person(actor);
  const row = await requireBook(deps.db, input.clientId, input.exportId);
  if (row.status !== "approved") throw localizedError("conflict", "brand.book.errors.notApproved");
  return queueRender(deps, user, row, true);
}

/** Called by the worker once a PDF is stored: the preview stays a draft, the final one is exported. */
export async function recordClientBookFile(
  db: Database,
  input: {
    exportId: string;
    final: boolean;
    storageKey: string;
    fileName: string;
    bytes: number;
    pages: number;
  },
) {
  const file = {
    storageKey: input.storageKey,
    fileName: input.fileName,
    bytes: input.bytes,
    pages: input.pages,
    updatedAt: new Date(),
  };
  if (!input.final) {
    await db
      .update(brandBookExports)
      .set(file)
      .where(and(eq(brandBookExports.id, input.exportId), eq(brandBookExports.status, "draft")));
    return;
  }
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(brandBookExports)
      .set({ ...file, status: "exported" })
      .where(and(eq(brandBookExports.id, input.exportId), eq(brandBookExports.status, "approved")))
      .returning();
    if (!row) return;
    await tx
      .update(brandBookExports)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(
        and(
          eq(brandBookExports.clientId, row.clientId),
          eq(brandBookExports.type, "client_book"),
          eq(brandBookExports.status, "exported"),
          ne(brandBookExports.id, row.id),
        ),
      );
  });
}
