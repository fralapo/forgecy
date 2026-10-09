import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { contents, createDb, eq, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getCarouselWorkspace,
  getStrategyOverview,
  createPillar,
  listCarousels,
  setContentArchived,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

/** ADR 0020: a person reaches only the clients assigned to them; Admins reach all. */
describe.skipIf(!dbUrl)("content: per-client access (integration)", () => {
  let db: Database;
  let f: AccessFixture;
  let onX: string;
  let onY: string;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
    const row = (clientId: string, title: string) => ({
      clientId,
      title,
      objective: "awareness" as const,
      channel: "instagram",
      format: "ig_portrait",
      templateKey: "none",
    });
    const made = await db
      .insert(contents)
      .values([row(f.x.id, "On X"), row(f.y.id, "On Y")])
      .returning({ id: contents.id });
    onX = made[0]!.id;
    onY = made[1]!.id;
  });

  afterAll(async () => {
    await f?.cleanup();
    await db?.$client.end();
  });

  it("lists only the carousels of an assigned client", async () => {
    expect((await listCarousels(db, f.member, f.x.id)).map((c) => c.id)).toContain(onX);
    await expect(listCarousels(db, f.member, f.y.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listCarousels(db, f.nobody, f.x.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await listCarousels(db, f.admin, f.y.id)).map((c) => c.id)).toContain(onY);
  });

  it("does not open another client's carousel by id", async () => {
    await expect(getCarouselWorkspace(db, f.member, f.y.id, onY)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    // Its own client with the other client's id: the pair does not exist.
    await expect(getCarouselWorkspace(db, f.member, f.x.id, onY)).rejects.toBeInstanceOf(
      ForgecyError,
    );
    await expect(getStrategyOverview(db, f.member, f.y.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("does not change another client's data", async () => {
    await expect(
      setContentArchived(db, f.member, { clientId: f.y.id, id: onY, archived: true }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      setContentArchived(db, f.member, { clientId: f.x.id, id: onY, archived: true }),
    ).rejects.toBeInstanceOf(ForgecyError);
    await expect(
      createPillar(db, f.nobody, f.x.id, { name: "Pillar" } as never),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const [y] = await db
      .select({ archivedAt: contents.archivedAt })
      .from(contents)
      .where(eq(contents.id, onY));
    expect(y?.archivedAt).toBeNull();
    await setContentArchived(db, f.admin, { clientId: f.y.id, id: onY, archived: true });
  });
});
