/**
 * The client's edited version of a delivered carousel (for example reworked in Canva).
 * A person attaches the slides (PNG, JPEG or WebP, up to 20) and/or a PDF to a published
 * content, writes down what the client changed per slide and may turn each note into a
 * PROPOSED brand lesson. Manual and auditable: no AI call, nothing is confirmed here, and
 * the content stays frozen (only `contents.client_version` changes).
 */
import { assertCan, type Actor } from "@forgecy/core";
import {
  actorKey,
  and,
  assets,
  brandLessons,
  contents,
  eq,
  inArray,
  sql,
  recordAuditEvent,
  type Database,
} from "@forgecy/db";
import { assertValidUpload, contentKey, sha256, type StorageDriver } from "@forgecy/files";
import { z } from "zod";
import { conflict, humanOnly, invalid } from "../access";
import { storeAsset } from "../assets";
import { getContentRow } from "./carousels";

export const CLIENT_VERSION_MAX_SLIDES = 20;
export const CLIENT_VERSION_TAG = "client-edit";
const NOTES_MAX = 60;

export const clientVersionNoteSchema = z.object({
  id: z.uuid(),
  /** 1-based slide the note is about; null for a note on the carousel as a whole. */
  slide: z.number().int().min(1).max(CLIENT_VERSION_MAX_SLIDES).nullable(),
  text: z.string().trim().min(1).max(600),
  /** The proposed brand lesson made from this note, once a person asked for it. */
  lessonId: z.uuid().nullable().default(null),
});
export type ClientVersionNote = z.output<typeof clientVersionNoteSchema>;

export const clientVersionSchema = z.object({
  attachedAt: z.string(),
  attachedBy: z.uuid(),
  /** Library assets (tag `client-edit`), in slide order. */
  slideAssetIds: z.array(z.uuid()).max(CLIENT_VERSION_MAX_SLIDES).default([]),
  pdf: z
    .object({
      key: z.string().max(300),
      name: z.string().max(200),
      size: z.number().int().nonnegative(),
      sha256: z.string().length(64),
    })
    .nullable()
    .default(null),
  notes: z.array(clientVersionNoteSchema).max(NOTES_MAX).default([]),
});
export type ClientVersion = z.output<typeof clientVersionSchema>;

/** The stored client version, or null when none was attached (or the JSON is not one). */
export function readClientVersion(value: unknown): ClientVersion | null {
  if (!value) return null;
  const r = clientVersionSchema.safeParse(value);
  return r.success ? r.data : null;
}

export interface ClientFile {
  bytes: Uint8Array;
  mime: string;
  name: string;
}

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Cap and type checks that do not need the database (also run by the upload route). */
export function assertClientFiles(input: {
  slides: readonly ClientFile[];
  pdf?: ClientFile | null | undefined;
}) {
  if (input.slides.length === 0 && !input.pdf) invalid("content.errors.clientVersionEmpty");
  if (input.slides.length > CLIENT_VERSION_MAX_SLIDES)
    invalid("content.errors.clientVersionTooMany", undefined, { max: CLIENT_VERSION_MAX_SLIDES });
  for (const f of input.slides)
    if (!IMAGE_MIMES.has(f.mime)) invalid("content.errors.clientVersionBadImage");
  if (input.pdf) {
    const t = assertValidUpload({
      kind: "document",
      mime: input.pdf.mime,
      size: input.pdf.bytes.length,
      firstBytes: input.pdf.bytes.slice(0, 1024),
    });
    if (t.mime !== "application/pdf") invalid("content.errors.clientVersionBadPdf");
  }
}

/**
 * Attach (or replace) the client's files on a published content. The notes written so far
 * stay. The delivered version becomes the client's: `client_version` is set.
 */
export async function attachClientVersion(
  db: Database,
  storage: StorageDriver,
  actor: Actor,
  input: {
    clientId: string;
    id: string;
    slides: ClientFile[];
    pdf?: ClientFile | null | undefined;
  },
) {
  humanOnly(actor, "assets.upload", input.clientId);
  humanOnly(actor, "publish", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (!c.publishedAt) conflict("content.errors.clientVersionNotPublished");
  assertClientFiles(input);

  const slideAssetIds: string[] = [];
  for (const [i, f] of input.slides.entries()) {
    const res = await storeAsset(db, storage, {
      clientId: input.clientId,
      bytes: f.bytes,
      declaredMime: f.mime,
      source: "upload",
      status: "approved",
      alt: f.name.slice(0, 200),
      tags: [CLIENT_VERSION_TAG],
      contentId: c.id,
      createdBy: actor.id,
    });
    // An identical file was already in the library: it is the client's slide too.
    if (!res.created && !res.row.tags.includes(CLIENT_VERSION_TAG))
      await db
        .update(assets)
        .set({ tags: [...res.row.tags, CLIENT_VERSION_TAG].slice(0, 20) })
        .where(eq(assets.id, res.row.id));
    slideAssetIds[i] = res.row.id;
  }
  let pdf: ClientVersion["pdf"] = null;
  if (input.pdf) {
    const hash = sha256(input.pdf.bytes);
    const key = contentKey({
      clientId: input.clientId,
      scope: "client-versions",
      sha256: hash,
      ext: "pdf",
    });
    if (!(await storage.exists(key)))
      await storage.put(key, input.pdf.bytes, {
        contentType: "application/pdf",
        contentLength: input.pdf.bytes.length,
      });
    pdf = {
      key,
      name: input.pdf.name.replace(/[\r\n"]/g, "").slice(0, 200) || "client-version.pdf",
      size: input.pdf.bytes.length,
      sha256: hash,
    };
  }
  const previous = readClientVersion(c.clientVersion);
  const next: ClientVersion = {
    attachedAt: new Date().toISOString(),
    attachedBy: actor.id,
    slideAssetIds,
    pdf,
    notes: previous?.notes ?? [],
  };
  const [row] = await db
    .update(contents)
    .set({ clientVersion: next })
    .where(and(eq(contents.id, c.id), sql`${contents.publishedAt} is not null`))
    .returning({ id: contents.id });
  if (!row) conflict("content.errors.clientVersionNotPublished");
  await recordAuditEvent(db, {
    actor,
    action: "content.client_version_attached",
    entity: "content",
    entityId: c.id,
    clientId: c.clientId,
    meta: { slides: slideAssetIds.length, pdf: Boolean(pdf) },
  });
  return next;
}

const noteInputSchema = z.object({
  id: z.uuid(),
  slide: z.number().int().min(1).max(CLIENT_VERSION_MAX_SLIDES).nullable(),
  text: z.string().max(600),
});

/** Replace the written notes (what the client changed). Lessons already made stay linked by note id. */
export async function saveClientChanges(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    id: string;
    notes: { id: string; slide: number | null; text: string }[];
  },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const notes = z
    .array(noteInputSchema)
    .max(NOTES_MAX)
    .parse(input.notes)
    .map((n) => ({ ...n, text: n.text.trim() }))
    .filter((n) => n.text.length > 0);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(contents)
      .where(and(eq(contents.id, input.id), eq(contents.clientId, input.clientId)))
      .for("update");
    const cv = readClientVersion(c?.clientVersion);
    if (!c || !cv) return conflict("content.errors.clientVersionMissing");
    const lessons = new Map(cv.notes.map((n) => [n.id, n.lessonId]));
    const next: ClientVersion = {
      ...cv,
      notes: notes.map((n) => ({ ...n, lessonId: lessons.get(n.id) ?? null })),
    };
    await tx.update(contents).set({ clientVersion: next }).where(eq(contents.id, c.id));
    await recordAuditEvent(tx, {
      actor,
      action: "content.client_changes_saved",
      entity: "content",
      entityId: c.id,
      clientId: c.clientId,
      meta: { notes: next.notes.length },
    });
    return next;
  });
}

/**
 * A person turns one note into a PROPOSED brand lesson (`proposedBy` is that person). It is
 * never confirmed here: confirming needs `brand_identity.approve` on the lessons log.
 */
export async function proposeLessonFromChange(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; noteId: string },
) {
  humanOnly(actor, "propose", input.clientId);
  humanOnly(actor, "edit_draft", input.clientId);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(contents)
      .where(and(eq(contents.id, input.id), eq(contents.clientId, input.clientId)))
      .for("update");
    const cv = readClientVersion(c?.clientVersion);
    if (!c || !cv) return conflict("content.errors.clientVersionMissing");
    const note = cv.notes.find((n) => n.id === input.noteId);
    if (!note) return invalid("content.errors.clientVersionNoteNotFound");
    if (note.lessonId) return conflict("content.errors.clientVersionLessonExists");
    const [lesson] = await tx
      .insert(brandLessons)
      .values({
        clientId: c.clientId,
        correction: (note.slide ? `[${note.slide}] ${note.text}` : note.text).slice(0, 600),
        rule: "",
        proposedBy: actorKey(actor),
      })
      .returning();
    await tx
      .update(contents)
      .set({
        clientVersion: {
          ...cv,
          notes: cv.notes.map((n) => (n.id === note.id ? { ...n, lessonId: lesson!.id } : n)),
        },
      })
      .where(eq(contents.id, c.id));
    await recordAuditEvent(tx, {
      actor,
      action: "brand.lesson_proposed",
      entity: "brand_lesson",
      entityId: lesson!.id,
      clientId: c.clientId,
      meta: { contentId: c.id, from: "client_version" },
    });
    return lesson!;
  });
}

/** The library rows of the client's slides, in slide order (people who can view the client). */
export async function clientVersionSlides(
  db: Database,
  actor: Actor,
  input: { clientId: string; version: ClientVersion },
) {
  assertCan(actor, "view", input.clientId);
  if (!input.version.slideAssetIds.length) return [];
  const rows = await db
    .select({ id: assets.id, storageKey: assets.storageKey, alt: assets.alt })
    .from(assets)
    .where(
      and(eq(assets.clientId, input.clientId), inArray(assets.id, input.version.slideAssetIds)),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return input.version.slideAssetIds.flatMap((id, i) => {
    const r = byId.get(id);
    return r ? [{ ...r, slide: i + 1 }] : [];
  });
}
