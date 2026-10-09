import { PermissionDeniedError } from "@forgecy/core";
import { createDb, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportableVersions, getBrandBookExport, listBrandBookExports } from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

/** ADR 0020: a person reaches only the clients assigned to them; Admins reach all. */
describe.skipIf(!dbUrl)("brand book: per-client access (integration)", () => {
  let db: Database;
  let f: AccessFixture;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
  });

  afterAll(async () => {
    await f?.cleanup();
    await db?.$client.end();
  });

  it("reads Brand Book exports only of an assigned client", async () => {
    await expect(listBrandBookExports(db, f.member, f.x.id)).resolves.toEqual([]);
    await expect(listBrandBookExports(db, f.member, f.y.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(exportableVersions(db, f.nobody, f.x.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      getBrandBookExport(db, f.member, { clientId: f.y.id, id: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listBrandBookExports(db, f.admin, f.y.id)).resolves.toEqual([]);
  });
});
