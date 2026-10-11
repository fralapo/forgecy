import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import { createDb, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideLesson, listLessons, proposeLesson } from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("brand: lessons log (integration)", () => {
  let db: Database;
  let f: AccessFixture;
  const agent: Actor = { type: "agent", role: "brand_analyst" };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
  });

  afterAll(async () => {
    await f?.cleanup();
    await db?.$client.end();
  });

  it("lets anyone propose but only a person confirm", async () => {
    const lesson = await proposeLesson(db, agent, {
      clientId: f.x.id,
      lesson: { correction: "Never write 'low cost'", rule: "Say 'accessible'" },
    });
    expect(lesson).toMatchObject({ status: "proposed", proposedBy: "agent:brand_analyst" });
    await expect(
      decideLesson(db, agent, { clientId: f.x.id, id: lesson.id, decision: "accepted" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await listLessons(db, f.member, f.x.id))[0]).toMatchObject({ status: "proposed" });
    const done = await decideLesson(db, f.member, {
      clientId: f.x.id,
      id: lesson.id,
      decision: "accepted",
    });
    expect(done).toMatchObject({ status: "accepted", decidedBy: f.member.id });
    await expect(
      decideLesson(db, f.member, { clientId: f.x.id, id: lesson.id, decision: "rejected" }),
    ).rejects.toBeInstanceOf(ForgecyError);
  });

  it("stays inside the client", async () => {
    const mine = await proposeLesson(db, f.member, {
      clientId: f.x.id,
      lesson: { correction: "Use the formal 'Lei'" },
    });
    await expect(
      proposeLesson(db, f.member, { clientId: f.y.id, lesson: { correction: "Nope nope" } }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listLessons(db, f.member, f.y.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      decideLesson(db, f.admin, { clientId: f.y.id, id: mine.id, decision: "accepted" }),
    ).rejects.toBeInstanceOf(ForgecyError);
  });
});
