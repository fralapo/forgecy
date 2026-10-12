import { PermissionDeniedError } from "@forgecy/core";
import { createDb, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBrandCheck } from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

/** ADR 0020: a person reaches only the clients assigned to them; Admins reach all. */
describe.skipIf(!dbUrl)("brand guard: per-client access (integration)", () => {
  let db: Database;
  let f: AccessFixture;
  const subject = { type: "carousel" as const, id: crypto.randomUUID(), version: 1 };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
  });

  afterAll(async () => {
    await f?.cleanup();
    await db?.$client.end();
  });

  it("reads Brand Guard checks only of an assigned client", async () => {
    await expect(getBrandCheck(db, f.member, { clientId: f.x.id, subject })).resolves.toBeNull();
    await expect(getBrandCheck(db, f.member, { clientId: f.y.id, subject })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(getBrandCheck(db, f.nobody, { clientId: f.x.id, subject })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(getBrandCheck(db, f.admin, { clientId: f.y.id, subject })).resolves.toBeNull();
  });
});
