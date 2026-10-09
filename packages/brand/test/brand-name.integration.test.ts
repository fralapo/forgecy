import {
  auditEvents,
  clients,
  createDb,
  eq,
  grantClientAccess,
  recordAuditEvent,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renameFromSite } from "../src/brand-name";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("renameFromSite (integration)", () => {
  let db: Database;
  const suffix = Math.random().toString(36).slice(2, 8);
  const clientIds: string[] = [];
  let anna: string;
  let outsider: string;

  const mkUser = async (name: string) =>
    (
      await db
        .insert(users)
        .values({ name, email: `${name}-${suffix}@example.test` })
        .returning()
    )[0]!.id;

  const mkClient = async (name: string, websiteUrl: string | null) => {
    const [c] = await db
      .insert(clients)
      .values({ name, slug: `rename-${clientIds.length}-${suffix}`, websiteUrl })
      .returning();
    clientIds.push(c!.id);
    await grantClientAccess(db, { userId: anna, clientId: c!.id, createdBy: null });
    return c!.id;
  };
  const nameOf = async (id: string) =>
    (await db.select({ name: clients.name }).from(clients).where(eq(clients.id, id)))[0]!.name;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    anna = await mkUser("anna");
    outsider = await mkUser("otto");
  });

  afterAll(async () => {
    if (db)
      for (const id of clientIds) {
        await db.delete(auditEvents).where(eq(auditEvents.clientId, id));
        await db.delete(clients).where(eq(clients.id, id));
      }
    await db?.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    await db?.$client.end();
  });

  const site = "https://www.staging-g.deodue.it";

  it("replaces the name guessed from the address, with an audit event", async () => {
    const id = await mkClient("Staging g", site);
    expect(await renameFromSite(db, { clientId: id, requestedBy: anna, name: "DeoDue" })).toBe(
      true,
    );
    expect(await nameOf(id)).toBe("DeoDue");
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.clientId, id));
    expect(event).toMatchObject({ action: "client.rename", actorUserId: anna });
    expect(event!.meta).toMatchObject({ auto: true, from: "Staging g", to: "DeoDue" });
    // Renamed once: the name is no longer the guess.
    expect(await renameFromSite(db, { clientId: id, requestedBy: anna, name: "Other" })).toBe(
      false,
    );
  });

  it("never renames a name a person wrote or saved", async () => {
    const typed = await mkClient("Deodue Italia", site);
    expect(await renameFromSite(db, { clientId: typed, requestedBy: anna, name: "DeoDue" })).toBe(
      false,
    );
    expect(await nameOf(typed)).toBe("Deodue Italia");

    // Same as the guess, but a person saved the client's details.
    const saved = await mkClient("Staging g", site);
    await recordAuditEvent(db, {
      actor: "system",
      action: "prospect.update",
      entity: "client",
      entityId: saved,
      clientId: saved,
    });
    expect(await renameFromSite(db, { clientId: saved, requestedBy: anna, name: "DeoDue" })).toBe(
      false,
    );
    expect(await nameOf(saved)).toBe("Staging g");
  });

  it("only for someone who may edit the client", async () => {
    const id = await mkClient("Staging g", site);
    for (const requestedBy of [outsider, null, "brand_analyst"])
      expect(await renameFromSite(db, { clientId: id, requestedBy, name: "DeoDue" })).toBe(false);
    expect(await nameOf(id)).toBe("Staging g");
  });

  it("does nothing without a better name", async () => {
    const id = await mkClient("Staging g", site);
    for (const name of [null, " ", "Staging g"])
      expect(await renameFromSite(db, { clientId: id, requestedBy: anna, name })).toBe(false);
  });
});
