import type { Actor } from "@forgecy/core";
import {
  appSettings,
  auditEvents,
  budgets,
  clients,
  createDb,
  eq,
  users,
  type Database,
} from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDbLedger,
  createMemoryLedger,
  DEFAULT_POLICY_KEY,
  getBudgetOverview,
  getDefaultAiPolicy,
  setDefaultAiPolicy,
  setMonthlyBudget,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("AI settings (integration)", () => {
  let db: Database;
  let admin: Actor;
  let clientId: string;
  const member: Actor = {
    type: "user",
    id: "00000000-0000-4000-8000-000000000001",
    isAdmin: false,
    active: true,
  };
  const agent: Actor = { type: "agent", role: "strategist" };
  const suffix = Math.random().toString(36).slice(2, 8);
  let previousDefault: unknown;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    const [u] = await db
      .insert(users)
      .values({ name: "Admin", email: `ai-settings-${suffix}@example.test`, isAdmin: true })
      .returning({ id: users.id });
    admin = { type: "user", id: u!.id, isAdmin: true, active: true };
    const [c] = await db
      .insert(clients)
      .values({ name: `Budget ${suffix}`, slug: `budget-${suffix}` })
      .returning({ id: clients.id });
    clientId = c!.id;
    previousDefault = (
      await db.select().from(appSettings).where(eq(appSettings.key, DEFAULT_POLICY_KEY))
    )[0]?.value;
  });

  afterAll(async () => {
    if (previousDefault === undefined)
      await db.delete(appSettings).where(eq(appSettings.key, DEFAULT_POLICY_KEY));
    else
      await db
        .update(appSettings)
        .set({ value: previousDefault })
        .where(eq(appSettings.key, DEFAULT_POLICY_KEY));
    await db.delete(budgets).where(eq(budgets.scopeId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
    if (admin?.type === "user") {
      await db.delete(auditEvents).where(eq(auditEvents.actorUserId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
    }
  });

  it("only Admins change the default policy, and it is read back", async () => {
    await expect(setDefaultAiPolicy(db, member, "no_ai")).rejects.toThrow(/Permission denied/);
    await expect(setDefaultAiPolicy(db, agent, "no_ai")).rejects.toThrow(/Permission denied/);
    await setDefaultAiPolicy(db, admin, "local_only");
    const current = await getDefaultAiPolicy(db);
    expect(current.policy).toBe("local_only");
    expect(current.updatedBy).toBe(admin.type === "user" ? admin.id : null);
  });

  it("a client budget carries over to later months until removed", async () => {
    const ledger = createDbLedger(db);
    const scope = { scope: "client" as const, clientId };
    await setMonthlyBudget(db, admin, scope, 2_500, new Date("2026-03-15T00:00:00Z"));
    expect(await ledger.budgetFor(scope, "2026-03-01")).toMatchObject({
      limitMicroUsd: 25_000_000,
    });
    expect(await ledger.budgetFor(scope, "2026-05-01")).toMatchObject({
      limitMicroUsd: 25_000_000,
    });
    expect(await ledger.budgetFor(scope, "2026-02-01")).toBeNull();

    // A new limit in May replaces it from May on and keeps March as history.
    await setMonthlyBudget(db, admin, scope, 9_900, new Date("2026-05-02T00:00:00Z"));
    expect(await ledger.budgetFor(scope, "2026-04-01")).toMatchObject({
      limitMicroUsd: 25_000_000,
    });
    expect(await ledger.budgetFor(scope, "2026-06-01")).toMatchObject({
      limitMicroUsd: 99_000_000,
    });

    const overview = await getBudgetOverview(db, new Date("2026-06-10T00:00:00Z"));
    expect(overview.clients.find((c) => c.clientId === clientId)?.limitCents).toBe(9_900);

    await setMonthlyBudget(db, admin, scope, null, new Date("2026-06-10T00:00:00Z"));
    expect(await ledger.budgetFor(scope, "2026-06-01")).toBeNull();
    expect(await ledger.budgetFor(scope, "2026-04-01")).toBeNull();
  });

  it("refuses budgets from non-Admins and invalid amounts", async () => {
    const scope = { scope: "client" as const, clientId };
    await expect(setMonthlyBudget(db, member, scope, 100)).rejects.toThrow(/Permission denied/);
    await expect(setMonthlyBudget(db, admin, scope, 0)).rejects.toThrow();
    await expect(setMonthlyBudget(db, admin, scope, 1.5)).rejects.toThrow();
  });
});

describe("memory ledger budgets", () => {
  it("carry over to later months like the database ledger", async () => {
    const ledger = createMemoryLedger();
    ledger.setBudget({ scope: "agency" }, "2026-03-01", { limitMicroUsd: 5, warnAtPercent: 70 });
    expect(await ledger.budgetFor({ scope: "agency" }, "2026-08-01")).toMatchObject({
      limitMicroUsd: 5,
    });
    expect(await ledger.budgetFor({ scope: "agency" }, "2026-02-01")).toBeNull();
    expect(await ledger.budgetFor({ scope: "client", clientId: "x" }, "2026-08-01")).toBeNull();
  });
});
