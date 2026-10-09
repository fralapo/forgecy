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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRAND_IMAGES_LIMIT, brandImageClass, listBrandImages } from "../src/read";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe("brandImageClass", () => {
  it("reads the class from the tags", () => {
    expect(brandImageClass(["scene", "site"])).toBe("scene");
    expect(brandImageClass(["social"])).toBeNull();
    expect(brandImageClass([])).toBeNull();
  });
});

describe.skipIf(!dbUrl)("listBrandImages (integration)", () => {
  let db: Database;
  const suffix = Math.random().toString(36).slice(2, 8);
  const clientIds: string[] = [];
  let member: NonNullable<Awaited<ReturnType<typeof userActor>>>;
  let outsider: NonNullable<Awaited<ReturnType<typeof userActor>>>;
  let clientId: string;
  let otherClientId: string;
  let n = 0;

  const asset = (
    client: string,
    over: Partial<typeof assets.$inferInsert> & { source: "site" | "upload" | "ai" | "product" },
  ) => {
    n++;
    return db.insert(assets).values({
      clientId: client,
      status: "approved",
      storageKey: `clients/${client}/assets/${n}.png`,
      sha256: `${suffix}-${n}`,
      mime: "image/png",
      size: 10,
      ...(over.source === "ai" ? { generation: { provider: "openrouter" } } : {}),
      ...over,
    });
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
    const memberId = await mk("mia");
    const outsiderId = await mk("omar");
    for (const name of ["one", "two"]) {
      const [c] = await db
        .insert(clients)
        .values({ name: `Imgs ${name} ${suffix}`, slug: `brand-imgs-${name}-${suffix}` })
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
      for (const id of clientIds) {
        await db.execute(sql`delete from assets where client_id = ${id}`);
        await db.delete(clients).where(eq(clients.id, id));
      }
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("lists only the pictures taken from the site and social profiles, with class and rights", async () => {
    await asset(clientId, { source: "site", tags: ["product", "site"], rights: { basis: "own" } });
    await asset(clientId, { source: "site", status: "draft", tags: ["scene", "site"] });
    await asset(clientId, { source: "site", status: "draft", tags: ["social"] });
    await asset(clientId, { source: "site", status: "rejected", tags: ["graphic", "site"] });
    await asset(clientId, { source: "upload", tags: ["product"] });
    await asset(clientId, { source: "ai", status: "draft" });
    await asset(clientId, { source: "product" });
    await asset(otherClientId, { source: "site", tags: ["product", "site"] });

    const rows = await listBrandImages(db, member, clientId);
    expect(rows).toHaveLength(3);
    const by = (c: string | null) => rows.find((r) => r.class === c)!;
    expect(by("product")).toMatchObject({
      source: "site",
      status: "approved",
      rightsPending: false,
    });
    expect(by("scene")).toMatchObject({ source: "site", status: "draft", rightsPending: true });
    expect(by(null)).toMatchObject({ source: "social", status: "draft", rightsPending: true });
    expect(rows.every((r) => r.storageKey.startsWith(`clients/${clientId}/`))).toBe(true);
  });

  it("is limited", async () => {
    for (let i = 0; i < BRAND_IMAGES_LIMIT + 3; i++)
      await asset(clientId, { source: "site", tags: ["graphic", "site"] });
    expect(await listBrandImages(db, member, clientId)).toHaveLength(BRAND_IMAGES_LIMIT);
  });

  it("refuses a person without access to the client", async () => {
    await expect(listBrandImages(db, outsider, clientId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(listBrandImages(db, member, otherClientId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});
