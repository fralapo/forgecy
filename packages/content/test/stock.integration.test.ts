import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  assets,
  auditEvents,
  clients,
  contents,
  createDb,
  eq,
  users,
  type Database,
} from "@forgecy/db";
import { LocalDiskDriver } from "@forgecy/files";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assetCommercialUse, confirmAssetRights, readAssetRights } from "../src/assets";
import { addStockCredit } from "../src/carousels/carousels";
import { importPexelsPhoto, stockCreditLine } from "../src/stock";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const FAKE_KEY = "fake-pexels-key-for-tests-0000";

// 8-byte PNG signature + IHDR (width 4, height 5) + padding: enough for magic-byte sniffing.
const png = (seed: number) =>
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

const raw = (id: number, host = "images.pexels.com") => ({
  id,
  url: `https://www.pexels.com/photo/${id}/`,
  photographer: "Ada Rossi",
  photographer_url: "https://www.pexels.com/@ada",
  alt: "A loaf of bread",
  width: 400,
  height: 500,
  avg_color: "#aa8855",
  src: {
    original: `https://${host}/photos/${id}/o.png`,
    large2x: `https://${host}/photos/${id}/l2.png`,
    large: `https://${host}/photos/${id}/l.png`,
    medium: `https://${host}/photos/${id}/m.png`,
  },
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PermissionDeniedError) return "permission_denied";
    if (err instanceof ForgecyError) return err.code;
    throw err;
  }
  return "ok";
}

describe.skipIf(!dbUrl)("Pexels stock photos in the library (integration)", () => {
  let db: Database;
  let actor: Extract<Actor, { type: "user" }>;
  let clientId: string;
  let contentId: string;
  let root: string;
  let storage: LocalDiskDriver;
  const suffix = Math.random().toString(36).slice(2, 8);

  /** Fake Pexels: photo 1 and 2 are fine, 3 points at another host. */
  const fakeFetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    const photo = /\/v1\/photos\/(\d+)$/.exec(url);
    if (photo) {
      const id = Number(photo[1]);
      return new Response(JSON.stringify(raw(id, id === 3 ? "evil.example" : undefined)), {
        status: 200,
      });
    }
    const img = /photos\/(\d+)\/l2\.png$/.exec(url);
    if (img) return new Response(png(Number(img[1])), { headers: { "content-type": "image/png" } });
    return new Response("nope", { status: 404 });
  });
  const opts = { apiKey: FAKE_KEY, fetch: fakeFetch as unknown as typeof fetch };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    root = mkdtempSync(join(tmpdir(), "forgecy-stock-"));
    storage = new LocalDiskDriver({
      root,
      baseUrl: "http://localhost:3000",
      secret: "x".repeat(32),
    });
    const [u] = await db
      .insert(users)
      .values({ name: "stella", email: `stella-${suffix}@example.test` })
      .returning();
    actor = { type: "user", id: u!.id, isAdmin: false, active: true, clients: "all" };
    const [c] = await db
      .insert(clients)
      .values({ name: `Stock ${suffix}`, slug: `stock-test-${suffix}` })
      .returning();
    clientId = c!.id;
    const [ct] = await db
      .insert(contents)
      .values({
        clientId,
        title: "t",
        objective: "awareness" as const,
        channel: "instagram",
        format: "ig_portrait",
        templateKey: "none",
        createdBy: actor.id,
      })
      .returning();
    contentId = ct!.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(auditEvents).where(eq(auditEvents.actorUserId, actor.id));
    await db.delete(users).where(eq(users.id, actor.id));
    await db.$client.end();
    rmSync(root, { recursive: true, force: true });
  });

  it("imports a photo as a stock asset with tags, metadata and pending rights", async () => {
    const res = await importPexelsPhoto(
      db,
      storage,
      actor,
      { clientId, photoId: 1, tags: ["bread"] },
      opts,
    );
    expect(res.created).toBe(true);
    expect(res.credit).toBe("Photo: Ada Rossi / Pexels");
    const [row] = await db.select().from(assets).where(eq(assets.id, res.row.id));
    expect(row).toMatchObject({
      source: "stock",
      status: "approved",
      mime: "image/png",
      tags: ["stock", "pexels", "bread"],
      alt: "A loaf of bread",
      rights: null,
    });
    expect(row!.stock).toMatchObject({
      provider: "pexels",
      photoId: 1,
      photographer: "Ada Rossi",
      photographerUrl: "https://www.pexels.com/@ada",
      licenseUrl: "https://www.pexels.com/license/",
    });
    expect(await storage.exists(row!.storageKey)).toBe(true);
    // Rights are never auto-approved: a person confirms them like an upload.
    expect(assetCommercialUse(row!)).toBe("pending_verification");
    await confirmAssetRights(db, actor, {
      clientId,
      id: row!.id,
      basis: "licensed",
      note: "Pexels License",
    });
    const [after] = await db.select().from(assets).where(eq(assets.id, row!.id));
    expect(readAssetRights(after!.rights)).toMatchObject({
      basis: "licensed",
      confirmedBy: actor.id,
    });
    expect(assetCommercialUse(after!)).toBe("verified");
    // Never sent with the key to storage or the browser-facing row.
    expect(JSON.stringify(row)).not.toContain(FAKE_KEY);
  });

  it("importing the same photo twice returns the same row", async () => {
    const a = await importPexelsPhoto(db, storage, actor, { clientId, photoId: 2 }, opts);
    const b = await importPexelsPhoto(db, storage, actor, { clientId, photoId: 2 }, opts);
    expect(b.created).toBe(false);
    expect(b.row.id).toBe(a.row.id);
  });

  it("refuses an image served from another host", async () => {
    expect(
      await codeOf(importPexelsPhoto(db, storage, actor, { clientId, photoId: 3 }, opts)),
    ).toBe("validation");
  });

  it("is unavailable without a key", async () => {
    expect(
      await codeOf(importPexelsPhoto(db, storage, actor, { clientId, photoId: 1 }, { apiKey: "" })),
    ).toBe("not_found");
  });

  it("is refused for an agent and for a person without access to the client", async () => {
    const agent: Actor = { type: "agent", role: "brand_analyst", runId: crypto.randomUUID() };
    expect(
      await codeOf(importPexelsPhoto(db, storage, agent, { clientId, photoId: 1 }, opts)),
    ).toBe("permission_denied");
    const outsider: Actor = { ...actor, clients: [] };
    expect(
      await codeOf(importPexelsPhoto(db, storage, outsider, { clientId, photoId: 1 }, opts)),
    ).toBe("permission_denied");
  });

  it("adds the photographer credit to the content once, from the stored metadata", async () => {
    const [stock] = await db.select().from(assets).where(eq(assets.clientId, clientId));
    const first = await addStockCredit(db, actor, { clientId, id: contentId, assetId: stock!.id });
    expect(first.added).toBe(true);
    const again = await addStockCredit(db, actor, { clientId, id: contentId, assetId: stock!.id });
    expect(again.added).toBe(false);
    const [c] = await db.select().from(contents).where(eq(contents.id, contentId));
    expect(c!.stockCredits).toEqual(["Photo: Ada Rossi / Pexels"]);
    const agent: Actor = { type: "agent", role: "copywriter" };
    expect(
      await codeOf(addStockCredit(db, agent, { clientId, id: contentId, assetId: stock!.id })),
    ).toBe("permission_denied");
  });

  it("builds the credit line only from a named photographer", () => {
    expect(stockCreditLine({ photographer: " Bo " })).toBe("Photo: Bo / Pexels");
    expect(stockCreditLine(null)).toBeNull();
    expect(stockCreditLine({ photographer: "" })).toBeNull();
  });
});
