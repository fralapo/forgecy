import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { PermissionDeniedError } from "@forgecy/core";
import {
  assets,
  clients,
  createDb,
  eq,
  grantClientAccess,
  sql,
  userActor,
  users,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  brandReferenceImages,
  REFERENCE_MAX_BYTES,
  REFERENCE_MAX_SIDE,
} from "../src/reference-images";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const noise = (w: number, h: number) =>
  sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } });

describe.skipIf(!dbUrl)("brandReferenceImages (integration)", () => {
  let db: Database;
  const suffix = Math.random().toString(36).slice(2, 8);
  const clientIds: string[] = [];
  const files = new Map<string, Uint8Array>();
  const storage = {
    get: async (key: string) => {
      const f = files.get(key);
      if (!f) throw new Error("missing");
      return Readable.from([Buffer.from(f)]);
    },
  } as unknown as StorageDriver;
  let member: NonNullable<Awaited<ReturnType<typeof userActor>>>;
  let outsider: NonNullable<Awaited<ReturnType<typeof userActor>>>;
  let clientId: string;
  let otherClientId: string;
  let n = 0;

  const rights = { basis: "own" };
  /** Stores `bytes` under a fresh key and registers it; the newest row sorts first. */
  const asset = async (
    client: string,
    bytes: Uint8Array,
    over: Partial<typeof assets.$inferInsert> = {},
  ) => {
    n++;
    const storageKey = `clients/${client}/assets/${suffix}-${n}`;
    files.set(storageKey, bytes);
    const [row] = await db
      .insert(assets)
      .values({
        clientId: client,
        source: "site",
        status: "approved",
        storageKey,
        sha256: `${suffix}-${n}`,
        mime: "image/png",
        size: bytes.byteLength,
        rights,
        tags: ["product", "site"],
        createdAt: new Date(Date.now() + n * 1000),
        ...over,
      })
      .returning({ id: assets.id });
    return row!.id;
  };
  const clear = async () => {
    for (const id of clientIds) await db.execute(sql`delete from assets where client_id = ${id}`);
    files.clear();
  };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const mk = async (name: string) => {
      const [u] = await db
        .insert(users)
        .values({ name, email: `${name}-${suffix}@example.test` })
        .returning();
      return u!.id;
    };
    const memberId = await mk("rita");
    const outsiderId = await mk("otto");
    for (const name of ["one", "two"]) {
      const [c] = await db
        .insert(clients)
        .values({ name: `Refs ${name} ${suffix}`, slug: `brand-refs-${name}-${suffix}` })
        .returning();
      clientIds.push(c!.id);
    }
    [clientId, otherClientId] = clientIds as [string, string];
    await grantClientAccess(db, { userId: memberId, clientId, createdBy: null });
    member = (await userActor(db, memberId))!;
    outsider = (await userActor(db, outsiderId))!;
  });

  afterAll(async () => {
    if (db) {
      await clear();
      for (const id of clientIds) await db.delete(clients).where(eq(clients.id, id));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("refuses a person without access to the client", async () => {
    await expect(brandReferenceImages(db, storage, outsider, clientId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(brandReferenceImages(db, storage, member, otherClientId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("takes only approved, rights-confirmed site pictures with a class, never other clients'", async () => {
    await clear();
    const small = await noise(300, 200).png().toBuffer();
    const ok = await asset(clientId, small);
    await asset(clientId, small, { status: "draft" });
    await asset(clientId, small, { status: "rejected" });
    await asset(clientId, small, { rights: null });
    await asset(clientId, small, { tags: ["social"] });
    await asset(clientId, small, { tags: ["product", "social"] });
    await asset(clientId, small, { tags: ["logo", "site"] });
    await asset(clientId, small, { tags: [] });
    await asset(clientId, small, { source: "upload" });
    await asset(clientId, small, { source: "product" });
    await asset(otherClientId, small);

    const refs = await brandReferenceImages(db, storage, member, clientId);
    expect(refs.map((r) => r.id)).toEqual([ok]);
    expect(refs[0]!.mimeType).toBe("image/jpeg");
  });

  it("prefers product, then scene, then graphic, one of each before a second", async () => {
    await clear();
    const bytes = await noise(200, 200).png().toBuffer();
    const p1 = await asset(clientId, bytes, { tags: ["product", "site"] });
    const p2 = await asset(clientId, bytes, { tags: ["product", "site"] });
    const g1 = await asset(clientId, bytes, { tags: ["graphic", "site"] });
    const s1 = await asset(clientId, bytes, { tags: ["scene", "site"] });

    const refs = await brandReferenceImages(db, storage, member, clientId);
    // Newest first inside a class; the second product only after one of each class.
    expect(refs.map((r) => r.id)).toEqual([p2, s1, g1, p1]);
    const two = await brandReferenceImages(db, storage, member, clientId, 2);
    expect(two.map((r) => r.id)).toEqual([p2, s1]);
  });

  it("skips an SVG, a corrupt file and a missing one, and fills from the next", async () => {
    await clear();
    const good = await noise(100, 100).jpeg().toBuffer();
    const a = await asset(clientId, good, { mime: "image/jpeg" });
    await asset(clientId, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), {
      mime: "image/svg+xml",
    });
    await asset(clientId, randomBytes(500));
    const missing = await asset(clientId, good);
    files.delete(
      (await db.select({ k: assets.storageKey }).from(assets).where(eq(assets.id, missing)))[0]!.k,
    );
    const b = await asset(clientId, good, { mime: "image/jpeg", tags: ["scene", "site"] });

    const refs = await brandReferenceImages(db, storage, member, clientId);
    expect(refs.map((r) => r.id).sort()).toEqual([a, b].sort());
  });

  it("downsizes to the cap in side and bytes", async () => {
    await clear();
    // Random noise is the worst case for JPEG: a large photo still has to fit.
    const big = await noise(3000, 2000).png().toBuffer();
    await asset(clientId, big);
    const [ref] = await brandReferenceImages(db, storage, member, clientId);
    const meta = await sharp(ref!.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(REFERENCE_MAX_SIDE);
    expect(ref!.data.byteLength).toBeLessThanOrEqual(REFERENCE_MAX_BYTES);
  });

  it("stops reading a file over the byte cap and closes its stream", async () => {
    await clear();
    const huge = Buffer.alloc(21 * 1024 * 1024);
    await asset(clientId, huge, { size: 1000 });
    let stream: Readable | undefined;
    const spying = {
      get: async (key: string) => (stream = (await storage.get(key)) as Readable),
    } as unknown as StorageDriver;
    expect(await brandReferenceImages(db, spying, member, clientId)).toEqual([]);
    expect(stream!.destroyed).toBe(true);
  });

  it("refuses a decompression bomb instead of decoding it", async () => {
    await clear();
    const bomb = await sharp({
      create: { width: 8000, height: 8000, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    await asset(clientId, bomb);
    expect(await brandReferenceImages(db, storage, member, clientId)).toEqual([]);
  });
});
