import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { createDb, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProduct, deleteProductFact, listProductFacts, saveProductFact } from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("catalog: product fact bank (integration)", () => {
  let db: Database;
  let f: AccessFixture;
  const as = (actor: AccessFixture["member"]) => ({ actor, id: actor.id, name: "Test" });

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
  });

  afterAll(async () => {
    await f?.cleanup();
    await db?.$client.end();
  });

  it("stores status and source, defaulting to catalog_only", async () => {
    const p = await createProduct(db, as(f.member), { clientId: f.x.id, name: "Bread" });
    const plain = await saveProductFact(db, as(f.member), {
      clientId: f.x.id,
      productId: p.id,
      fact: { text: "Baked daily" },
    });
    expect(plain).toMatchObject({ status: "catalog_only", source: "", keywords: [] });
    const strict = await saveProductFact(db, as(f.member), {
      clientId: f.x.id,
      productId: p.id,
      fact: {
        text: "Cures backache",
        status: "do_not_use",
        source: "catalog p. 4",
        keywords: ["cure"],
      },
    });
    const edited = await saveProductFact(db, as(f.member), {
      clientId: f.x.id,
      productId: p.id,
      factId: plain.id,
      fact: { text: "Baked daily", status: "printed_on_pack", source: "pack back" },
    });
    expect(edited).toMatchObject({ status: "printed_on_pack", source: "pack back" });
    const all = await listProductFacts(db, f.x.id, p.id);
    expect(all.map((x) => [x.text, x.status])).toEqual([
      ["Baked daily", "printed_on_pack"],
      ["Cures backache", "do_not_use"],
    ]);
    await deleteProductFact(db, as(f.member), {
      clientId: f.x.id,
      productId: p.id,
      factId: strict.id,
    });
    expect(await listProductFacts(db, f.x.id, p.id)).toHaveLength(1);
  });

  it("filters by client and permission", async () => {
    const p = await createProduct(db, as(f.admin), { clientId: f.y.id, name: "Cake" });
    const fact = { text: "Gluten free" };
    await expect(
      saveProductFact(db, as(f.member), { clientId: f.y.id, productId: p.id, fact }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      saveProductFact(db, as(f.member), { clientId: f.x.id, productId: p.id, fact }),
    ).rejects.toBeInstanceOf(ForgecyError);
    const agent = {
      actor: { type: "agent" as const, role: "brand_analyst" as const },
      id: f.member.id,
      name: "Agent",
    };
    await expect(
      saveProductFact(db, agent, { clientId: f.y.id, productId: p.id, fact }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await listProductFacts(db, f.y.id, p.id)).toEqual([]);
  });
});
