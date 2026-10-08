import {
  aiPolicies,
  assertCan,
  isLocalProvider,
  providerIds,
  sendableAssetTypes,
  type Actor,
  type AiPolicy,
  type ClientStatus,
  type ProviderId,
  type SendableAssetType,
} from "@forgecy/core";
import {
  and,
  appSettings,
  budgets,
  clients,
  desc,
  eq,
  gte,
  isNull,
  jobsLog,
  lt,
  lte,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import { monthKey } from "./ledger";

/**
 * Admin settings for AI policies and budgets (page “AI policies and budgets”).
 * Budgets are monthly and standing: a limit set this month keeps applying in the
 * following months until an Admin changes or removes it (see `createDbLedger`).
 */

export const DEFAULT_POLICY_KEY = "ai.default_policy";

function userId(actor: Actor): string | null {
  return actor.type === "user" ? actor.id : null;
}

export interface DefaultPolicy {
  policy: AiPolicy;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** The policy given to new clients and prospects; `external_allowed` until an Admin sets one. */
export async function getDefaultAiPolicy(db: Pick<Database, "select">): Promise<DefaultPolicy> {
  const [row] = await db
    .select({
      value: appSettings.value,
      updatedAt: appSettings.updatedAt,
      updatedBy: appSettings.updatedBy,
    })
    .from(appSettings)
    .where(eq(appSettings.key, DEFAULT_POLICY_KEY));
  const policy = aiPolicies.find((p) => p === row?.value) ?? "external_allowed";
  return row
    ? { policy, updatedAt: row.updatedAt, updatedBy: row.updatedBy }
    : { policy, updatedAt: null, updatedBy: null };
}

/** Admin only. Applies to clients created from now on; existing clients keep theirs. */
export async function setDefaultAiPolicy(
  db: Database,
  actor: Actor,
  policy: AiPolicy,
): Promise<void> {
  assertCan(actor, "ai.policies.manage");
  if (!aiPolicies.includes(policy)) throw new Error(`Unknown AI policy: ${policy}`);
  const before = await getDefaultAiPolicy(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: DEFAULT_POLICY_KEY, value: policy, updatedBy: userId(actor) })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: policy, updatedBy: userId(actor), updatedAt: new Date() },
      });
    await recordAuditEvent(tx, {
      actor,
      action: "default_ai_policy_changed",
      entity: "app_settings",
      entityId: DEFAULT_POLICY_KEY,
      meta: { from: before.policy, to: policy },
    });
  });
}

export const CATALOG_AI_KEY = "catalog.ai_enabled";

/**
 * PDF AI-extraction and AI image-to-product matching in the catalog import (v1 features,
 * UX_SPECIFICATION §D-24): off for every client until an Admin turns this on here, regardless
 * of any client's AI policy. Manual entry, CSV/XLSX and deterministic ZIP/folder matching
 * are never affected.
 */
export async function getCatalogAiEnabled(db: Pick<Database, "select">): Promise<boolean> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, CATALOG_AI_KEY));
  return row?.value === true;
}

/** Admin only. Applies instance-wide, immediately, to every client. */
export async function setCatalogAiEnabled(
  db: Database,
  actor: Actor,
  enabled: boolean,
): Promise<void> {
  assertCan(actor, "ai.policies.manage");
  await db.transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: CATALOG_AI_KEY, value: enabled, updatedBy: userId(actor) })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: enabled, updatedBy: userId(actor), updatedAt: new Date() },
      });
    await recordAuditEvent(tx, {
      actor,
      action: "catalog_ai_enabled_changed",
      entity: "app_settings",
      entityId: CATALOG_AI_KEY,
      meta: { enabled },
    });
  });
}

/** Providers an Admin can approve for an external_restricted client; local models always are. */
export const restrictableProviders: readonly ProviderId[] = providerIds.filter(
  (p) => !isLocalProvider(p),
);

/**
 * Admin only. The external providers that may receive an external_restricted client's
 * data (page 61); the gateway sends nothing to the others. At least one is required.
 */
export async function setApprovedProviders(
  db: Database,
  actor: Actor,
  clientId: string,
  providers: readonly ProviderId[],
): Promise<void> {
  assertCan(actor, "ai.policies.manage", clientId);
  const next = restrictableProviders.filter((p) => providers.includes(p));
  if (next.length === 0 || next.length !== new Set(providers).size)
    throw new Error("Approve at least one known external provider");
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ approvedProviders: clients.approvedProviders })
      .from(clients)
      .where(eq(clients.id, clientId));
    if (!before) throw new Error(`Client not found: ${clientId}`);
    await tx
      .update(clients)
      .set({ approvedProviders: next, updatedAt: new Date() })
      .where(eq(clients.id, clientId));
    await recordAuditEvent(tx, {
      actor,
      action: "approved_providers_changed",
      entity: "client",
      entityId: clientId,
      clientId,
      meta: { from: before.approvedProviders, to: next },
    });
  });
}

/**
 * Admin only. The kinds of files and texts an external_restricted client may send to
 * its approved providers (page 61); the gateway keeps the others on a local model.
 */
export async function setSendableAssets(
  db: Database,
  actor: Actor,
  clientId: string,
  kinds: readonly SendableAssetType[],
): Promise<void> {
  assertCan(actor, "ai.policies.manage", clientId);
  const next = sendableAssetTypes.filter((k) => kinds.includes(k));
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ sendableAssets: clients.sendableAssets })
      .from(clients)
      .where(eq(clients.id, clientId));
    if (!before) throw new Error(`Client not found: ${clientId}`);
    await tx
      .update(clients)
      .set({ sendableAssets: next, updatedAt: new Date() })
      .where(eq(clients.id, clientId));
    await recordAuditEvent(tx, {
      actor,
      action: "sendable_assets_changed",
      entity: "client",
      entityId: clientId,
      clientId,
      meta: { from: before.sendableAssets, to: next },
    });
  });
}

export type BudgetTarget = { scope: "agency" } | { scope: "client"; clientId: string };

/**
 * Admin only. Sets the monthly limit from the current month on (`limitCents`), or removes
 * it (`null`): without a limit the agency has none, and a client follows the agency's.
 */
export async function setMonthlyBudget(
  db: Database,
  actor: Actor,
  target: BudgetTarget,
  limitCents: number | null,
  now: Date = new Date(),
): Promise<void> {
  assertCan(actor, "ai.budgets.manage", target.scope === "client" ? target.clientId : undefined);
  if (limitCents !== null && (!Number.isInteger(limitCents) || limitCents <= 0))
    throw new Error("Budget must be a positive whole number of cents");
  const month = monthKey(now);
  const scopeId = target.scope === "client" ? target.clientId : null;
  const sameScope = and(
    eq(budgets.scope, target.scope),
    scopeId ? eq(budgets.scopeId, scopeId) : isNull(budgets.scopeId),
  );
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ limitCents: budgets.limitCents })
      .from(budgets)
      .where(and(sameScope, lte(budgets.month, month)))
      .orderBy(desc(budgets.month))
      .limit(1);
    if (limitCents === null) {
      // No limit from now on: older rows must not carry over either.
      await tx.delete(budgets).where(sameScope);
    } else {
      // Limits set for this month or later are replaced; earlier months stay as history.
      await tx.delete(budgets).where(and(sameScope, gte(budgets.month, month)));
      await tx.insert(budgets).values({ scope: target.scope, scopeId, month, limitCents });
    }
    await recordAuditEvent(tx, {
      actor,
      action: "budget_changed",
      entity: "budget",
      entityId: scopeId ?? "agency",
      ...(scopeId ? { clientId: scopeId } : {}),
      meta: { scope: target.scope, month, before: before?.limitCents ?? null, after: limitCents },
    });
  });
}

export interface BudgetLine {
  limitCents: number | null;
  warnAtPercent: number;
  spentMicroUsd: number;
}

export interface ClientBudgetLine extends BudgetLine {
  clientId: string;
  name: string;
  slug: string;
  status: ClientStatus;
  aiPolicy: AiPolicy;
  approvedProviders: ProviderId[];
  sendableAssets: SendableAssetType[];
}

export interface BudgetOverview {
  month: string;
  agency: BudgetLine;
  clients: ClientBudgetLine[];
}

function monthBounds(month: string): { start: Date; end: Date } {
  const start = new Date(`${month}T00:00:00.000Z`);
  return { start, end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) };
}

/** Month-to-date spend and limits for the agency and every client that is not archived. */
export async function getBudgetOverview(
  db: Pick<Database, "select">,
  now: Date = new Date(),
): Promise<BudgetOverview> {
  const month = monthKey(now);
  const { start, end } = monthBounds(month);

  const [limits, spend, clientRows] = await Promise.all([
    db
      .select({
        scopeId: budgets.scopeId,
        limitCents: budgets.limitCents,
        warnAtPercent: budgets.warnAtPercent,
      })
      .from(budgets)
      .where(lte(budgets.month, month))
      .orderBy(desc(budgets.month)),
    db
      .select({
        clientId: jobsLog.clientId,
        total: sql<string>`coalesce(sum(${jobsLog.costMicroUsd}), 0)`,
      })
      .from(jobsLog)
      .where(and(gte(jobsLog.startedAt, start), lt(jobsLog.startedAt, end)))
      .groupBy(jobsLog.clientId),
    db
      .select({
        id: clients.id,
        name: clients.name,
        slug: clients.slug,
        status: clients.status,
        aiPolicy: clients.aiPolicy,
        approvedProviders: clients.approvedProviders,
        sendableAssets: clients.sendableAssets,
      })
      .from(clients)
      .where(isNull(clients.archivedAt))
      .orderBy(clients.name),
  ]);

  // Rows are newest first, so the first one per scope is the limit in force.
  const limitFor = new Map<string, { limitCents: number; warnAtPercent: number }>();
  for (const row of limits) {
    const key = row.scopeId ?? "agency";
    if (!limitFor.has(key))
      limitFor.set(key, { limitCents: row.limitCents, warnAtPercent: row.warnAtPercent });
  }
  const spendFor = new Map<string, number>();
  let agencySpend = 0;
  for (const row of spend) {
    const total = Number(row.total);
    agencySpend += total;
    if (row.clientId) spendFor.set(row.clientId, total);
  }
  const line = (key: string, spent: number): BudgetLine => ({
    limitCents: limitFor.get(key)?.limitCents ?? null,
    warnAtPercent: limitFor.get(key)?.warnAtPercent ?? 70,
    spentMicroUsd: spent,
  });

  return {
    month,
    agency: line("agency", agencySpend),
    clients: clientRows.map((c) => ({
      clientId: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      aiPolicy: c.aiPolicy,
      approvedProviders: c.approvedProviders,
      sendableAssets: c.sendableAssets,
      ...line(c.id, spendFor.get(c.id) ?? 0),
    })),
  };
}

/** Percentage of the limit already spent, or null without a limit. */
export function budgetPercent(line: Pick<BudgetLine, "limitCents" | "spentMicroUsd">) {
  if (!line.limitCents) return null;
  return (line.spentMicroUsd / (line.limitCents * 10_000)) * 100;
}
