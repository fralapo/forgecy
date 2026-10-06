import type { AiPolicy, ProviderId } from "@forgecy/core";
import { and, budgets, eq, gte, isNull, jobsLog, lt, sql, type Database } from "@forgecy/db";

export type BudgetScope = { scope: "agency" } | { scope: "client"; clientId: string };

export interface BudgetLimit {
  limitMicroUsd: number;
  warnAtPercent: number;
}

/** One jobs_log row. `inputSummary` holds field names, sizes and hashes, never raw content. */
export interface LedgerEntry {
  jobId?: string | null;
  kind: string;
  clientId?: string | null;
  contentId?: string | null;
  status: "ok" | "error" | "blocked";
  provider?: ProviderId | null;
  model?: string | null;
  policy?: AiPolicy | null;
  authorizedBy?: string | null;
  inputSummary: Record<string, unknown>;
  resultRef?: string | null;
  tokensIn: number;
  tokensOut: number;
  costMicroUsd: number;
  error?: string | null;
  startedAt: Date;
  endedAt?: Date | null;
}

export interface AiLedger {
  /** Sum of jobs_log cost for the month starting at `month` ("YYYY-MM-01", UTC). */
  monthSpendMicroUsd(scope: BudgetScope, month: string): Promise<number>;
  budgetFor(scope: BudgetScope, month: string): Promise<BudgetLimit | null>;
  record(entry: LedgerEntry): Promise<void>;
}

/** "YYYY-MM-01" for the UTC month containing `date`. */
export function monthKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function monthRange(month: string): { start: Date; end: Date } {
  const start = new Date(`${month}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error(`Invalid month key: ${month}`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end };
}

const CENTS_TO_MICRO = 10_000;

/** Drizzle-backed ledger on jobs_log and budgets. */
export function createDbLedger(db: Pick<Database, "select" | "insert">): AiLedger {
  return {
    async monthSpendMicroUsd(scope, month) {
      const { start, end } = monthRange(month);
      const conds = [gte(jobsLog.startedAt, start), lt(jobsLog.startedAt, end)];
      if (scope.scope === "client") conds.push(eq(jobsLog.clientId, scope.clientId));
      const rows = await db
        .select({ total: sql<string>`coalesce(sum(${jobsLog.costMicroUsd}), 0)` })
        .from(jobsLog)
        .where(and(...conds));
      return Number(rows[0]?.total ?? 0);
    },
    async budgetFor(scope, month) {
      const rows = await db
        .select({ limitCents: budgets.limitCents, warnAtPercent: budgets.warnAtPercent })
        .from(budgets)
        .where(
          and(
            eq(budgets.scope, scope.scope),
            scope.scope === "client"
              ? eq(budgets.scopeId, scope.clientId)
              : isNull(budgets.scopeId),
            eq(budgets.month, month),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row
        ? { limitMicroUsd: row.limitCents * CENTS_TO_MICRO, warnAtPercent: row.warnAtPercent }
        : null;
    },
    async record(entry) {
      await db.insert(jobsLog).values({
        jobId: entry.jobId ?? null,
        kind: entry.kind,
        clientId: entry.clientId ?? null,
        contentId: entry.contentId ?? null,
        status: entry.status,
        provider: entry.provider ?? null,
        model: entry.model ?? null,
        policy: entry.policy ?? null,
        authorizedBy: entry.authorizedBy ?? null,
        inputSummary: entry.inputSummary,
        resultRef: entry.resultRef ?? null,
        tokensIn: entry.tokensIn,
        tokensOut: entry.tokensOut,
        costMicroUsd: entry.costMicroUsd,
        error: entry.error ?? null,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt ?? null,
      });
    },
  };
}

/** In-memory ledger for tests and scripts. Budgets keyed by "agency" or "client:<id>" per month. */
export interface MemoryLedger extends AiLedger {
  readonly entries: LedgerEntry[];
  setBudget(scope: BudgetScope, month: string, limit: BudgetLimit): void;
}

export function createMemoryLedger(): MemoryLedger {
  const entries: LedgerEntry[] = [];
  const limits = new Map<string, BudgetLimit>();
  const key = (scope: BudgetScope, month: string) =>
    `${scope.scope === "client" ? `client:${scope.clientId}` : "agency"}@${month}`;
  return {
    entries,
    setBudget(scope, month, limit) {
      limits.set(key(scope, month), limit);
    },
    async monthSpendMicroUsd(scope, month) {
      const { start, end } = monthRange(month);
      return entries
        .filter((e) => e.startedAt >= start && e.startedAt < end)
        .filter((e) => scope.scope === "agency" || e.clientId === scope.clientId)
        .reduce((sum, e) => sum + e.costMicroUsd, 0);
    },
    async budgetFor(scope, month) {
      return limits.get(key(scope, month)) ?? null;
    },
    async record(entry) {
      entries.push(structuredClone(entry));
    },
  };
}
