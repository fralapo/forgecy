import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { createDb, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureDraft,
  findOrCreateWebsiteSource,
  getBrandWorkspace,
  getPublishedBrandIdentity,
  listSources,
  removeSource,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

/** ADR 0020: a person reaches only the clients assigned to them; Admins reach all. */
describe.skipIf(!dbUrl)("brand: per-client access (integration)", () => {
  let db: Database;
  let f: AccessFixture;
  let sourceOfY: string;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
    sourceOfY = (
      await findOrCreateWebsiteSource(db, f.admin, {
        clientId: f.y.id,
        websiteUrl: "https://y.example/",
      })
    ).id;
  });

  afterAll(async () => {
    await f?.cleanup();
    await db?.$client.end();
  });

  it("reads only the Brand Identity of an assigned client", async () => {
    await expect(getBrandWorkspace(db, f.member, f.x.id)).resolves.toBeDefined();
    for (const read of [getBrandWorkspace, getPublishedBrandIdentity, listSources])
      await expect(read(db, f.member, f.y.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(getBrandWorkspace(db, f.nobody, f.x.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    expect((await listSources(db, f.admin, f.y.id)).map((s) => s.id)).toContain(sourceOfY);
  });

  it("does not reach another client's rows by id or change them", async () => {
    // The existing source is returned only to people who may open its client.
    await expect(
      findOrCreateWebsiteSource(db, f.member, {
        clientId: f.y.id,
        websiteUrl: "https://y.example/",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      removeSource(db, f.member, { clientId: f.y.id, sourceId: sourceOfY }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    // Its own client with the other client's source id: not found, nothing removed.
    await expect(
      removeSource(db, f.member, { clientId: f.x.id, sourceId: sourceOfY }),
    ).rejects.toBeInstanceOf(ForgecyError);
    expect((await listSources(db, f.admin, f.y.id)).map((s) => s.id)).toContain(sourceOfY);
    await expect(ensureDraft(db, f.member, f.y.id)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
