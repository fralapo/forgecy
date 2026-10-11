import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { assets, brandLessons, contents, createDb, eq, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { LocalDiskDriver } from "@forgecy/files";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attachClientVersion,
  getContentRow,
  proposeLessonFromChange,
  readClientVersion,
  saveClientChanges,
  saveDraft,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const png = (seed: number): Uint8Array =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    0,
    0,
    0,
    4,
    0,
    0,
    0,
    5,
    8,
    6,
    0,
    0,
    0,
    seed,
    seed,
    seed,
  ]);
const file = (seed: number) => ({ bytes: png(seed), mime: "image/png", name: `s${seed}.png` });
const pdf = {
  bytes: new TextEncoder().encode("%PDF-1.7\n%test"),
  mime: "application/pdf",
  name: "client.pdf",
};

describe.skipIf(!dbUrl)("client version of a delivered carousel (integration)", () => {
  let db: Database;
  let f: AccessFixture;
  let root: string;
  let storage: LocalDiskDriver;
  let published: string;
  let draftOnly: string;
  let onY: string;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
    root = mkdtempSync(join(tmpdir(), "forgecy-cv-"));
    storage = new LocalDiskDriver({
      root,
      baseUrl: "http://localhost:3000",
      secret: "x".repeat(32),
    });
    const row = (clientId: string, title: string, extra = {}) => ({
      clientId,
      title,
      objective: "awareness" as const,
      channel: "instagram",
      format: "ig_portrait",
      templateKey: "none",
      ...extra,
    });
    const made = await db
      .insert(contents)
      .values([
        row(f.x.id, "Published", { publishedAt: new Date(), publishedBy: f.member.id }),
        row(f.x.id, "Not published"),
        row(f.y.id, "Other client", { publishedAt: new Date() }),
      ])
      .returning({ id: contents.id });
    published = made[0]!.id;
    draftOnly = made[1]!.id;
    onY = made[2]!.id;
  });

  afterAll(async () => {
    await f?.cleanup();
    await db?.$client.end();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("refuses people not assigned to the client and agents", async () => {
    const input = { clientId: f.x.id, id: published, slides: [file(1)] };
    await expect(attachClientVersion(db, storage, f.nobody, input)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      attachClientVersion(db, storage, f.member, { clientId: f.y.id, id: onY, slides: [file(1)] }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      attachClientVersion(db, storage, { type: "agent", role: "copywriter" } as never, input),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      saveClientChanges(db, f.nobody, { clientId: f.x.id, id: published, notes: [] }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("only attaches to a published carousel", async () => {
    await expect(
      attachClientVersion(db, storage, f.member, {
        clientId: f.x.id,
        id: draftOnly,
        slides: [file(2)],
      }),
    ).rejects.toBeInstanceOf(ForgecyError);
  });

  it("stores tagged assets and the pdf, marks the client version, keeps the content frozen", async () => {
    const before = await getContentRow(db, f.x.id, published);
    const cv = await attachClientVersion(db, storage, f.member, {
      clientId: f.x.id,
      id: published,
      slides: [file(3), file(4)],
      pdf,
    });
    expect(cv.slideAssetIds).toHaveLength(2);
    expect(cv.pdf?.key).toMatch(/\/client-versions\/[a-f0-9]{64}\.pdf$/);
    expect(await storage.exists(cv.pdf!.key)).toBe(true);
    const rows = await db.select().from(assets).where(eq(assets.contentId, published));
    expect(rows.map((r) => r.tags)).toEqual(Array(2).fill(["client-edit"]));
    expect(rows.every((r) => r.source === "upload" && r.status === "approved")).toBe(true);

    const after = await getContentRow(db, f.x.id, published);
    expect(readClientVersion(after.clientVersion)?.slideAssetIds).toEqual(cv.slideAssetIds);
    // Frozen stays frozen: the delivery record and the copy are untouched.
    expect(after.publishedAt).toEqual(before.publishedAt);
    expect(after.deliveredVersionId).toBe(before.deliveredVersionId);
    expect(after.status).toBe(before.status);
    expect(after.draftRev).toBe(before.draftRev);
    await expect(
      saveDraft(db, f.member, {
        clientId: f.x.id,
        id: published,
        draftRev: after.draftRev,
        document: { title: "x", slides: [], hashtags: [] } as never,
      }),
    ).rejects.toBeInstanceOf(ForgecyError);
  });

  it("notes become proposed lessons, once, and never confirmed", async () => {
    const id = crypto.randomUUID();
    await saveClientChanges(db, f.member, {
      clientId: f.x.id,
      id: published,
      notes: [
        { id, slide: 6, text: "  Removed slide 6: it sounded like an ad  " },
        { id: crypto.randomUUID(), slide: null, text: "   " },
      ],
    });
    const cv = readClientVersion((await getContentRow(db, f.x.id, published)).clientVersion)!;
    expect(cv.notes).toHaveLength(1);
    expect(cv.notes[0]).toMatchObject({ slide: 6, lessonId: null });

    await expect(
      proposeLessonFromChange(db, f.nobody, { clientId: f.x.id, id: published, noteId: id }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const lesson = await proposeLessonFromChange(db, f.member, {
      clientId: f.x.id,
      id: published,
      noteId: id,
    });
    expect(lesson).toMatchObject({
      status: "proposed",
      proposedBy: `user:${f.member.id}`,
      decidedBy: null,
    });
    expect(lesson.correction).toBe("[6] Removed slide 6: it sounded like an ad");
    await expect(
      proposeLessonFromChange(db, f.member, { clientId: f.x.id, id: published, noteId: id }),
    ).rejects.toBeInstanceOf(ForgecyError);
    expect(
      await db.select().from(brandLessons).where(eq(brandLessons.clientId, f.x.id)),
    ).toHaveLength(1);
    // Saving the notes again keeps the link to the lesson.
    await saveClientChanges(db, f.member, {
      clientId: f.x.id,
      id: published,
      notes: [{ id, slide: 6, text: "Removed slide 6" }],
    });
    const again = readClientVersion((await getContentRow(db, f.x.id, published)).clientVersion)!;
    expect(again.notes[0]?.lessonId).toBe(lesson.id);
  });
});
