import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import { assets, auditEvents, clients, createDb, eq, users, type Database } from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetCommercialUse, confirmAssetRights, readAssetRights } from "../src/assets";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

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

describe.skipIf(!dbUrl)("rights of library images (integration)", () => {
  let db: Database;
  let actor: Extract<Actor, { type: "user" }>;
  let clientId: string;
  let n = 0;
  const suffix = Math.random().toString(36).slice(2, 8);

  const asset = async (source: "upload" | "site" | "product") => {
    n++;
    const [row] = await db
      .insert(assets)
      .values({
        clientId,
        source,
        status: "draft",
        storageKey: `clients/${clientId}/assets/${n}.png`,
        sha256: `${suffix}-${n}`,
        mime: "image/png",
        size: 10,
      })
      .returning();
    return row!;
  };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    const [u] = await db
      .insert(users)
      .values({ name: "rita", email: `rita-${suffix}@example.test` })
      .returning();
    actor = { type: "user", id: u!.id, isAdmin: false, active: true, clients: "all" };
    const [c] = await db
      .insert(clients)
      .values({ name: `Rights ${suffix}`, slug: `rights-test-${suffix}` })
      .returning();
    clientId = c!.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(auditEvents).where(eq(auditEvents.actorUserId, actor.id));
    await db.delete(users).where(eq(users.id, actor.id));
    await db.$client.end();
  });

  it("a person confirms the rights of an image taken from the website", async () => {
    const a = await asset("site");
    expect(assetCommercialUse(a)).toBe("pending_verification");
    await confirmAssetRights(db, actor, { clientId, id: a.id, basis: "own", note: "" });
    const [row] = await db.select().from(assets).where(eq(assets.id, a.id));
    expect(readAssetRights(row!.rights)).toMatchObject({ basis: "own", confirmedBy: actor.id });
    expect(assetCommercialUse(row!)).toBe("verified");
  });

  it("still works for uploads, and not for product photos", async () => {
    const up = await asset("upload");
    expect(await codeOf(confirmAssetRights(db, actor, { clientId, id: up.id, basis: "own" }))).toBe(
      "ok",
    );
    const product = await asset("product");
    expect(
      await codeOf(confirmAssetRights(db, actor, { clientId, id: product.id, basis: "own" })),
    ).toBe("not_found");
  });

  it("is refused for another client's image and for an agent", async () => {
    const a = await asset("site");
    const other = crypto.randomUUID();
    expect(
      await codeOf(confirmAssetRights(db, actor, { clientId: other, id: a.id, basis: "own" })),
    ).toBe("not_found");
    const agent: Actor = { type: "agent", role: "brand_analyst", runId: crypto.randomUUID() };
    expect(
      await codeOf(confirmAssetRights(db, agent, { clientId, id: a.id, basis: "own" })),
    ).not.toBe("ok");
  });
});
