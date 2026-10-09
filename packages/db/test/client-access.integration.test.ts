import { readFileSync } from "node:fs";
import { PermissionDeniedError } from "@forgecy/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  auditEvents,
  clientAccess,
  clientMembers,
  clients,
  clientScopeWhere,
  createDb,
  eq,
  inArray,
  listNotifications,
  loadClientScope,
  notify,
  setClientAccess,
  unreadNotificationCount,
  users,
  type Database,
} from "../src";
import { createAccessFixture, type AccessFixture } from "../src/testing";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("per-client access (integration, ADR 0020)", () => {
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

  it("the upgrade backfill: people keep what they had, Admins get no rows, nothing is duplicated", async () => {
    const file = new URL("../migrations/0032_client_access.sql", import.meta.url);
    const statement = readFileSync(file, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .find((s) => s.includes('INSERT INTO "client_access"'))!;
    const ids = [f.admin.id, f.member.id, f.nobody.id];
    let rows: Array<{ userId: string; clientId: string }>;
    const client = await db.$client.connect();
    try {
      await client.query("begin");
      await client.query(statement);
      // Running it twice changes nothing (ON CONFLICT DO NOTHING keeps the existing row).
      await client.query(statement);
      const res = await client.query<{ user_id: string; client_id: string }>(
        `select user_id, client_id from client_access
          where user_id = any($1::uuid[]) and client_id = any($2::uuid[])`,
        [ids, [f.x.id, f.y.id]],
      );
      rows = res.rows.map((r) => ({ userId: r.user_id, clientId: r.client_id }));
      await client.query("rollback");
    } finally {
      client.release();
    }
    const pairs = rows.map((r) => `${r.userId}:${r.clientId}`).sort();
    expect(pairs).toEqual(
      [
        `${f.member.id}:${f.x.id}`,
        `${f.member.id}:${f.y.id}`,
        `${f.nobody.id}:${f.x.id}`,
        `${f.nobody.id}:${f.y.id}`,
      ].sort(),
    );
  });

  it("builds each person's scope from their assignments", async () => {
    expect(f.admin.clients).toBe("all");
    expect(f.member.clients).toEqual([f.x.id]);
    expect(f.nobody.clients).toEqual([]);
    expect(await loadClientScope(db, f.member.id)).toEqual([f.x.id]);
  });

  it("filters lists to the clients the actor may open", async () => {
    const visible = async (actor: AccessFixture["member"]) =>
      (
        await db
          .select({ id: clients.id })
          .from(clients)
          .where(and(inArray(clients.id, [f.x.id, f.y.id]), clientScopeWhere(actor, clients.id)))
      )
        .map((r) => r.id)
        .sort();
    expect(await visible(f.member)).toEqual([f.x.id]);
    expect(await visible(f.nobody)).toEqual([]);
    expect(await visible(f.admin)).toEqual([f.x.id, f.y.id].sort());
    expect(clientScopeWhere({ type: "agent", role: "reviewer" }, clients.id)).toBeUndefined();
  });

  it("only Admins assign and unassign, and each change is in the activity log", async () => {
    await expect(
      setClientAccess(db, f.member, { userId: f.member.id, clientId: f.y.id, granted: true }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await setClientAccess(db, f.admin, { userId: f.nobody.id, clientId: f.y.id, granted: true });
    expect(await loadClientScope(db, f.nobody.id)).toEqual([f.y.id]);
    const members = await clientMembers(db, f.admin, f.y.id);
    expect(members.map((m) => m.id)).toContain(f.nobody.id);
    expect(members.map((m) => m.id)).toContain(f.admin.id);
    expect(members.map((m) => m.id)).not.toContain(f.member.id);
    await setClientAccess(db, f.admin, { userId: f.nobody.id, clientId: f.y.id, granted: false });
    expect(await loadClientScope(db, f.nobody.id)).toEqual([]);
    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.clientId, f.y.id), eq(auditEvents.actorUserId, f.admin.id)));
    expect(events.map((e) => e.action).sort()).toEqual([
      "client_access.grant",
      "client_access.revoke",
    ]);
    // Seeing who has access needs access to the client.
    await expect(clientMembers(db, f.member, f.y.id)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("notifies only people who can open the client, and hides older ones after unassigning", async () => {
    const sent = await notify(db, {
      kind: "content_review_requested",
      to: [f.member.id, f.nobody.id],
      clientId: f.x.id,
      href: (slug) => `/content/${slug}`,
    });
    expect(sent).toBe(1);
    expect(await unreadNotificationCount(db, f.nobody.id)).toBe(0);
    expect(await listNotifications(db, f.member.id)).toHaveLength(1);
    await db.delete(clientAccess).where(eq(clientAccess.userId, f.member.id));
    expect(await listNotifications(db, f.member.id)).toHaveLength(0);
    expect(await unreadNotificationCount(db, f.member.id)).toBe(0);
    await db.insert(clientAccess).values({ userId: f.member.id, clientId: f.x.id });
    // An Admin hears about every client.
    expect(
      await notify(db, {
        kind: "content_review_requested",
        to: [f.admin.id],
        clientId: f.y.id,
        href: "/",
      }),
    ).toBe(1);
  });

  it("removes assignments with the person or the client", async () => {
    const [temp] = await db
      .insert(users)
      .values({ name: "Temp", email: `acl-temp-${Date.now()}@example.test` })
      .returning({ id: users.id });
    await db.insert(clientAccess).values({ userId: temp!.id, clientId: f.y.id });
    await db.delete(users).where(eq(users.id, temp!.id));
    expect(
      await db.select().from(clientAccess).where(eq(clientAccess.userId, temp!.id)),
    ).toHaveLength(0);
  });
});
