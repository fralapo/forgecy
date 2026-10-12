/**
 * Agent statistics (spec pages 54–55, tab Statistics): runs per week, failures by
 * reason, cost per month, and the proposals people decided in the last 90 days.
 * Proposals are counted where agents leave them: Brand Identity proposals, audit
 * observations, strategy items, product field proposals and memories.
 */
import { agentRoles, type AgentRole } from "@forgecy/core";
import { jobsLog, sql, type Database } from "@forgecy/db";
import { runAgentSql } from "./agents";

/** The rate is shown only from this many decided proposals (UXA-P4-34). */
export const ACCEPTANCE_MIN_DECIDED = 10;
export const ACCEPTANCE_WINDOW_DAYS = 90;

export interface ProposalOutcomes {
  accepted: number;
  rejected: number;
  /** Superseded before anyone decided (a newer value replaced the field). */
  stale: number;
}

const DAY = 24 * 3600 * 1000;

/** Proposals decided in the window, per agent (the Planner's strategy items are the Strategist's). */
export async function agentProposalOutcomes(
  db: Pick<Database, "execute">,
  now = new Date(),
): Promise<Record<AgentRole, ProposalOutcomes>> {
  const since = new Date(now.getTime() - ACCEPTANCE_WINDOW_DAYS * DAY).toISOString();
  const strategy = (table: string) => sql`
    select case provenance->>'agent' when 'planner' then 'strategist' else provenance->>'agent' end,
      status::text, coalesce(decided_at, updated_at)
    from ${sql.identifier(table)} where provenance->>'agent' is not null`;
  const res = await db.execute<{ agent: string; outcome: string; n: number }>(sql`
    select agent,
      case when status in ('accepted', 'edited', 'approved', 'archived') then 'accepted'
           when status = 'rejected' then 'rejected'
           when status = 'stale' then 'stale' end as outcome,
      count(*)::int as n
    from (
      select agent_role as agent, status::text as status, coalesce(reviewed_at, updated_at) as at
        from brand_identity_proposals where author_type = 'agent'
      union all
      select author_agent, status::text, updated_at from audit_findings where author_agent is not null
      union all ${strategy("content_pillars")}
      union all ${strategy("content_rubrics")}
      union all ${strategy("content_plan_items")}
      union all
      select substring(proposed_by from 7), status::text, coalesce(decided_at, created_at)
        from product_field_proposals where proposed_by like 'agent:%'
      union all
      select proposed_by_agent::text, status::text, decided_at
        from memory_items where proposed_by_agent is not null and decided_at is not null
    ) p (agent, status, at)
    where at >= ${since}
      and status in ('accepted', 'edited', 'approved', 'archived', 'rejected', 'stale')
    group by 1, 2`);
  const out = {} as Record<AgentRole, ProposalOutcomes>;
  for (const a of agentRoles) {
    const n = (o: string) => res.rows.find((r) => r.agent === a && r.outcome === o)?.n ?? 0;
    out[a] = { accepted: n("accepted"), rejected: n("rejected"), stale: n("stale") };
  }
  return out;
}

/** Accepted share of the proposals people decided; null below the minimum. */
export function acceptanceRate(o: ProposalOutcomes): number | null {
  const decided = o.accepted + o.rejected;
  return decided >= ACCEPTANCE_MIN_DECIDED ? o.accepted / decided : null;
}

export interface AgentStatistics {
  /** Last 12 weeks, oldest first; `week` is the Monday (UTC). */
  weeks: Array<{ week: Date; runs: number; failed: number }>;
  /** Failed and blocked runs of the last 90 days by reason (`error` for provider failures). */
  failures: Array<{ reason: string; count: number }>;
  /** Last 6 calendar months, oldest first. */
  months: Array<{ month: Date; costMicroUsd: number }>;
  proposals: ProposalOutcomes;
  /** Slide instructions kept or undone in 90 days (Copywriter only). */
  slideEdits: { kept: number; reverted: number } | null;
}

function mondayUtc(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

export async function agentStatistics(
  db: Pick<Database, "execute">,
  agent: AgentRole,
  now = new Date(),
): Promise<AgentStatistics> {
  const firstWeek = new Date(mondayUtc(now).getTime() - 11 * 7 * DAY);
  const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const since90 = new Date(now.getTime() - ACCEPTANCE_WINDOW_DAYS * DAY);
  const from = [firstWeek, firstMonth, since90].reduce((a, b) => (a < b ? a : b));
  const runs = sql`(select ${runAgentSql()} as agent, started_at, status,
      ${jobsLog.inputSummary}->>'blockedReason' as reason, cost_micro_usd
    from ${jobsLog} where started_at >= ${from.toISOString()}) r`;
  const [weekly, failures, monthly, outcomes, edits] = await Promise.all([
    db.execute<{ week: string; runs: number; failed: number }>(sql`
      select to_char(date_trunc('week', started_at at time zone 'UTC'), 'YYYY-MM-DD') as week,
        count(*)::int as runs, count(*) filter (where status <> 'ok')::int as failed
      from ${runs} where agent = ${agent} and started_at >= ${firstWeek.toISOString()}
      group by 1`),
    db.execute<{ reason: string; count: number }>(sql`
      select coalesce(reason, 'error') as reason, count(*)::int as count
      from ${runs} where agent = ${agent} and status <> 'ok' and started_at >= ${since90.toISOString()}
      group by 1 order by 2 desc`),
    db.execute<{ month: string; cost: number }>(sql`
      select to_char(date_trunc('month', started_at at time zone 'UTC'), 'YYYY-MM-DD') as month,
        coalesce(sum(cost_micro_usd), 0)::bigint::float8 as cost
      from ${runs} where agent = ${agent} and started_at >= ${firstMonth.toISOString()}
      group by 1`),
    agentProposalOutcomes(db, now),
    agent === "copywriter"
      ? db.execute<{ kept: number; reverted: number }>(sql`
          select count(*) filter (where status = 'kept')::int as kept,
            count(*) filter (where status = 'reverted')::int as reverted
          from content_slide_edits where updated_at >= ${since90.toISOString()}`)
      : null,
  ]);
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const week = new Date(firstWeek.getTime() + i * 7 * DAY);
    const row = weekly.rows.find((r) => r.week === week.toISOString().slice(0, 10));
    return { week, runs: row?.runs ?? 0, failed: row?.failed ?? 0 };
  });
  const months = Array.from({ length: 6 }, (_, i) => {
    const month = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1));
    const row = monthly.rows.find((r) => r.month === month.toISOString().slice(0, 10));
    return { month, costMicroUsd: Number(row?.cost ?? 0) };
  });
  return {
    weeks,
    failures: failures.rows.map((r) => ({ reason: r.reason, count: r.count })),
    months,
    proposals: outcomes[agent],
    slideEdits: edits
      ? { kept: edits.rows[0]?.kept ?? 0, reverted: edits.rows[0]?.reverted ?? 0 }
      : null,
  };
}
