import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { createDb, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProduct, duplicateProduct, openDraftImport, updateProductFields } from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

/** ADR 0020: a person reaches only the clients assigned to them; Admins reach all. */
describe.skipIf(!dbUrl)("catalog: per-client access (integration)", () => {
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

  it("adds products only to an assigned client", async () => {
    await expect(
      createProduct(db, as(f.member), { clientId: f.x.id, name: "Bread" }),
    ).resolves.toMatchObject({ clientId: f.x.id });
    await expect(
      createProduct(db, as(f.member), { clientId: f.y.id, name: "Bread" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      createProduct(db, as(f.nobody), { clientId: f.x.id, name: "Bread" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(openDraftImport(db, as(f.member), f.y.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("does not change another client's product by id", async () => {
    const product = await createProduct(db, as(f.admin), { clientId: f.y.id, name: "Cake" });
    await expect(
      duplicateProduct(db, as(f.member), { clientId: f.y.id, productId: product.id }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      updateProductFields(db, as(f.member), {
        clientId: f.x.id,
        productId: product.id,
        revision: product.revision,
        patch: { name: "Changed" },
      }),
    ).rejects.toBeInstanceOf(ForgecyError);
  });
});
