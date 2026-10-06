import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  aiConnections,
  and,
  appSettings,
  auditEvents,
  clients,
  createDb,
  eq,
  users,
  type Database,
} from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialUseFor, getCommercialUseReviews, setCommercialUse } from "../src/assets";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const key = "ai.commercial_use.google";

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PermissionDeniedError) return "permission_denied";
    if (err instanceof ForgecyError) return err.code;
    throw err;
  }
  return "ok";
}

describe.skipIf(!dbUrl)("commercial use of image providers (integration)", () => {
  let db: Database;
  let admin: Extract<Actor, { type: "user" }>;
  let member: Extract<Actor, { type: "user" }>;
  let clientId: string;
  let saved: typeof appSettings.$inferSelect | undefined;
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    [saved] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    await db.delete(appSettings).where(eq(appSettings.key, key));
    const mk = async (name: string, isAdmin: boolean) => {
      const [u] = await db
        .insert(users)
        .values({ name, email: `${name}-${suffix}@example.test`, isAdmin })
        .returning();
      return { type: "user" as const, id: u!.id, isAdmin, active: true };
    };
    admin = await mk("carla", true);
    member = await mk("dario", false);
    const [c] = await db
      .insert(clients)
      .values({ name: `Uso ${suffix}`, slug: `uso-test-${suffix}` })
      .returning();
    clientId = c!.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(appSettings).where(eq(appSettings.key, key));
    if (saved) await db.insert(appSettings).values(saved);
    await db.delete(aiConnections).where(eq(aiConnections.scopeId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(auditEvents).where(eq(auditEvents.actorUserId, admin.id));
    await db.delete(users).where(eq(users.id, admin.id));
    await db.delete(users).where(eq(users.id, member.id));
    await db.$client.end();
  });

  it("is pending until an Admin verifies the terms", async () => {
    expect(await commercialUseFor(db, "google", clientId)).toBe("pending_verification");
    expect(
      await codeOf(setCommercialUse(db, member, { provider: "google", status: "verified" })),
    ).toBe("permission_denied");
    expect(
      await codeOf(setCommercialUse(db, admin, { provider: "google", status: "verified" })),
    ).toBe("validation");

    await setCommercialUse(db, admin, {
      provider: "google",
      status: "verified",
      termsUrl: "https://ai.google.dev/gemini-api/terms",
      consultedOn: "2026-10-06",
      note: "",
    });
    expect(await commercialUseFor(db, "google", clientId)).toBe("verified");
    const review = (await getCommercialUseReviews(db)).get("google");
    expect(review).toMatchObject({
      status: "verified",
      consultedOn: "2026-10-06",
      note: null,
      updatedBy: { id: admin.id, name: "carla" },
    });
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.actorUserId, admin.id), eq(auditEvents.entity, "ai_provider")));
    expect(event).toMatchObject({
      action: "commercial_use_status_changed",
      entityId: "google",
      meta: { status: "verified", before: null },
    });
  });

  it("lets a client's own connection override the agency's decision", async () => {
    await db.insert(aiConnections).values({
      scope: "client",
      scopeId: clientId,
      provider: "google",
      status: "active",
      encryptedKey: "test",
      keyHint: "…test",
      commercialUseStatus: "rejected",
    });
    expect(await commercialUseFor(db, "google", clientId)).toBe("rejected");
  });
});
