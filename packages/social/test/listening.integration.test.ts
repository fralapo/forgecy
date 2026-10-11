import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import { createDb, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSignal,
  deleteSignal,
  getSignal,
  listSignalTags,
  listSignals,
  setSignalStatus,
  updateSignal,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("listening grid (integration)", () => {
  let db: Database;
  let f: AccessFixture;
  const agent: Actor = { type: "agent", role: "strategist" };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
  });

  afterAll(async () => {
    await f?.cleanup();
    await db?.$client.end();
  });

  it("logs, edits, marks, filters and deletes a signal", async () => {
    const a = await createSignal(db, f.member, {
      clientId: f.x.id,
      signal: { text: "Si lava in lavatrice?", platform: "facebook", tag: "cura" },
    });
    expect(a).toMatchObject({ status: "new", platform: "facebook", createdBy: f.member.id });
    const b = await createSignal(db, f.member, {
      clientId: f.x.id,
      signal: { text: "Dove lo spedite?", url: "https://example.test/p/1", tag: "spedizione" },
    });
    expect(await listSignalTags(db, f.member, f.x.id)).toEqual(["cura", "spedizione"]);

    await updateSignal(db, f.member, {
      clientId: f.x.id,
      id: a.id,
      signal: { text: "Si lava in lavatrice a 30?", platform: "facebook", tag: "cura" },
    });
    await setSignalStatus(db, f.member, { clientId: f.x.id, id: a.id, status: "recurring" });

    const recurring = await listSignals(db, f.member, f.x.id, { status: "recurring" });
    expect(recurring.map((s) => s.text)).toEqual(["Si lava in lavatrice a 30?"]);
    const byTag = await listSignals(db, f.member, f.x.id, { tag: "spedizione" });
    expect(byTag.map((s) => s.id)).toEqual([b.id]);
    expect((await getSignal(db, f.member, f.x.id, b.id))?.url).toBe("https://example.test/p/1");

    await deleteSignal(db, f.member, { clientId: f.x.id, id: b.id });
    expect(await getSignal(db, f.member, f.x.id, b.id)).toBeNull();
    await expect(deleteSignal(db, f.member, { clientId: f.x.id, id: b.id })).rejects.toBeInstanceOf(
      ForgecyError,
    );
  });

  it("refuses agents, people without the client, and a signal of another client", async () => {
    const mine = await createSignal(db, f.admin, {
      clientId: f.x.id,
      signal: { text: "Fate anche la taglia XL?" },
    });
    await expect(
      createSignal(db, agent, { clientId: f.x.id, signal: { text: "from an agent" } }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      setSignalStatus(db, agent, { clientId: f.x.id, id: mine.id, status: "used" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      createSignal(db, f.member, { clientId: f.y.id, signal: { text: "not my client" } }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listSignals(db, f.nobody, f.x.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    // Knowing the id is not enough: the client id in the call must own the row.
    await expect(
      deleteSignal(db, f.admin, { clientId: f.y.id, id: mine.id }),
    ).rejects.toBeInstanceOf(ForgecyError);
    expect(await getSignal(db, f.admin, f.y.id, mine.id)).toBeNull();
  });
});
