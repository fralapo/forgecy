import { PermissionDeniedError } from "@forgecy/core";
import { automations, createDb, eq, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteAutomation, getAutomation, listAutomations, listRuns } from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

/** ADR 0020: a person reaches only the clients assigned to them; Admins reach all. */
describe.skipIf(!dbUrl)("automations: per-client access (integration)", () => {
  let db: Database;
  let f: AccessFixture;
  let onX: string;
  let onY: string;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
    const made = await db
      .insert(automations)
      .values([
        { clientId: f.x.id, name: "Weekly X", source: "briefs" as const },
        { clientId: f.y.id, name: "Weekly Y", source: "briefs" as const },
      ])
      .returning({ id: automations.id });
    onX = made[0]!.id;
    onY = made[1]!.id;
  });

  afterAll(async () => {
    await f?.cleanup();
    await db?.$client.end();
  });

  it("lists only the automations of assigned clients", async () => {
    const ids = async (actor: AccessFixture["member"]) =>
      (await listAutomations(db, actor)).map((a) => a.id);
    expect(await ids(f.member)).toContain(onX);
    expect(await ids(f.member)).not.toContain(onY);
    const nobody = await ids(f.nobody);
    expect(nobody).not.toContain(onX);
    expect(nobody).not.toContain(onY);
    expect(await ids(f.admin)).toEqual(expect.arrayContaining([onX, onY]));
  });

  it("does not open or delete another client's automation by id", async () => {
    await expect(getAutomation(db, f.member, onY)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listRuns(db, f.member, onY)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(deleteAutomation(db, f.member, onY)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await db.select().from(automations).where(eq(automations.id, onY))).toHaveLength(1);
    await expect(getAutomation(db, f.admin, onY)).resolves.toMatchObject({ id: onY });
  });
});
