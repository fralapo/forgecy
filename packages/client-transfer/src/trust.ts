/**
 * What an imported row is allowed to claim (ADR 0015). A package is written by someone else,
 * so a row that says "approved by Ada" or "published" is a claim, not a fact in this
 * installation. Anything that unlocks export, publication, AI use or autonomous runs comes in
 * a state that a person here has to move forward again, and no approval is attributed to a
 * person (people are matched by email, which a package can forge).
 *
 * Fail closed: every client table with a status, approval, publication or export column needs
 * a rule below, every value of a status enum needs a target, and every such column must be
 * named by the rule. `checkTrustCoverage` runs when this module loads, so a new table, a new
 * status value or a new approval column stops the importer until somebody decides what it
 * means (same idea as SOFT_REFS in graph.ts). Pure: returns a copy; null drops the row.
 */
import { schema } from "@forgecy/db";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { clientTables } from "./graph";
import { UnsafePackageError, type Row } from "./safety";

export interface ExistingConsent {
  aiPolicy: string;
  approvedProviders: string[];
  sendableAssets: string[];
}
export interface TrustContext {
  clientId: string;
  /** The replaced client's current AI consent (replacement only). */
  existing: ExistingConsent | null;
}

export interface TrustRule {
  /** The row is not imported. */
  drop?: true;
  /** The `status` column: every value of its enum mapped to what it becomes (itself = kept). */
  status?: Record<string, string>;
  /** Limits the status mapping to the rows where this holds. */
  when?: (row: Row) => boolean;
  /** Always set to null. Nullable columns only. */
  clear?: string[];
  /** Always overwritten. */
  set?: Row;
  /** What the declarative parts cannot say; runs last. */
  custom?: (row: Row, ctx: TrustContext) => Row;
  /** Gate columns that `custom` handles or that are deliberately left as they are. */
  other?: string[];
  /** Required when the rule changes nothing: why that is safe. */
  why?: string;
}

/** Columns that carry an approval, a decision, a publication or an export, or a state a gate reads. */
const GATE =
  /^(status|decision|verdict|self_approval|ai_policy|approved_providers|sendable_assets|delivered_at)$|approv|publish|export|^decided_|^reviewed_|^reviewer_id$|^submit|^review_/;

const same = (...values: string[]): Record<string, string> =>
  Object.fromEntries(values.map((v) => [v, v]));
/** `same(all)` with some values sent to `target`. */
const demote = (all: string[], target: string, ...from: string[]): Record<string, string> => ({
  ...same(...all),
  ...Object.fromEntries(from.map((v) => [v, target])),
});

const DECIDED = ["decided_by", "decided_at"];
const PIPELINE = "progress of a collection or import pipeline; nothing is released from it";
const WORKING =
  "working analysis of the agency; the report or carousel that releases it is a draft";

const CONTENT_STATUS = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "exported",
  "archived",
];
const REPORT_STATUS = ["draft", "in_review", "approved", "exported", "superseded"];
const STRATEGY_STATUS = ["proposed", "accepted", "rejected", "stale", "archived"];

export const TRUST_RULES: Record<string, TrustRule> = {
  clients: {
    status: same("prospect", "active", "archived"),
    other: ["ai_policy", "approved_providers", "sendable_assets"],
    custom: (r, c) =>
      c.existing
        ? {
            ...r,
            ai_policy: c.existing.aiPolicy,
            approved_providers: c.existing.approvedProviders,
            sendable_assets: c.existing.sendableAssets,
          }
        : { ...r, approved_providers: [] },
  },
  contents: {
    status: demote(
      CONTENT_STATUS,
      "draft",
      "in_review",
      "changes_requested",
      "approved",
      "exported",
    ),
    clear: [
      "approved_version_id",
      "outline_approved_by",
      "outline_approved_at",
      "reviewer_id",
      "review_note",
      "submitted_by",
      "lock_expires_at",
    ],
  },
  content_approvals: { drop: true },
  content_exports: { drop: true },
  content_creative_directions: {
    status: { proposed: "proposed", accepted: "proposed", rejected: "stale", stale: "stale" },
    clear: DECIDED,
  },
  content_pillars: { status: same(...STRATEGY_STATUS), clear: DECIDED },
  content_rubrics: { status: same(...STRATEGY_STATUS), clear: DECIDED },
  content_plan_items: { status: same(...STRATEGY_STATUS), clear: DECIDED },
  content_plans: {
    status: same("proposed", "active", "superseded"),
    why: "the plan is the agency's own working data; it releases nothing",
  },
  content_slide_edits: {
    status: same("queued", "applied", "kept", "reverted", "failed"),
    why: "record of edits on a carousel that is a draft",
  },
  assets: {
    status: demote(["draft", "approved", "rejected"], "draft", "approved"),
    // An AI image is a draft until a person here approves it; an upload is the client's own file.
    when: (r) => r.source === "ai",
    clear: DECIDED,
  },
  automations: {
    status: demote(["draft", "active", "paused", "failed"], "paused", "active"),
  },
  automation_runs: {
    status: demote(
      ["running", "paused", "completed", "partial", "failed", "cancelled"],
      "cancelled",
      "running",
    ),
  },
  automation_run_items: {
    status: demote(
      ["queued", "running", "completed", "failed", "cancelled"],
      "cancelled",
      "queued",
      "running",
    ),
  },
  audits: {
    status: demote(
      [
        "draft",
        "collecting",
        "awaiting_competitors",
        "analyzing",
        "in_review",
        "reviewed",
        "delivered",
        "failed",
        "archived",
      ],
      "in_review",
      "reviewed",
      "delivered",
    ),
    clear: ["reviewed_by", "reviewed_at", "delivered_at"],
  },
  audit_reports: {
    status: demote(REPORT_STATUS, "draft", "in_review", "approved", "exported"),
    clear: [
      "submitted_by",
      "submitted_at",
      "reviewer_id",
      "submit_note",
      "approved_by",
      "approved_at",
      "approval_note",
      "exported_at",
    ],
  },
  audit_report_exports: { drop: true },
  site_scans: {
    status: same(
      "pending",
      "collecting",
      "collected",
      "partial",
      "unavailable",
      "skipped",
      "failed",
    ),
    why: PIPELINE,
  },
  audit_sources: {
    status: same(
      "pending",
      "collecting",
      "collected",
      "partial",
      "unavailable",
      "skipped",
      "failed",
    ),
    why: PIPELINE,
  },
  audit_channels: {
    status: same(
      "pending",
      "collecting",
      "collected",
      "partial",
      "unavailable",
      "skipped",
      "failed",
    ),
    why: PIPELINE,
  },
  audit_competitors: { status: same("proposed", "confirmed", "removed"), why: WORKING },
  audit_findings: { status: same("observed", "accepted", "edited", "rejected"), why: WORKING },
  audit_plans: { status: same("observed", "accepted", "edited", "rejected"), why: WORKING },
  templates: {
    status: demote(
      ["draft", "in_review", "approved", "published", "archived"],
      "draft",
      "in_review",
      "approved",
      "published",
      "archived",
    ),
    clear: ["submitted_at", "published_at", "published_by", "archived_at"],
    set: { origin: "agency", validation: {} },
    // A template of the package is the client's own draft, never a system or shared one.
    custom: (r, c) => ({ ...r, client_id: c.clientId }),
  },
  brand_identity_versions: {
    status: {
      draft: "draft",
      in_review: "draft",
      approved: "archived",
      published: "archived",
      archived: "archived",
    },
    clear: [
      "submitted_by",
      "submitted_at",
      "review_comment",
      "approved_by",
      "approved_at",
      "approval_note",
      "published_by",
      "published_at",
    ],
    // Archived, so that a person can restore it as a new draft.
    custom: (r) =>
      r.status === "archived" && !r.archived_at
        ? { ...r, archived_at: new Date().toISOString() }
        : r,
  },
  brand_identity_proposals: {
    status: { proposed: "proposed", accepted: "stale", rejected: "stale", stale: "stale" },
    clear: ["reviewed_by", "reviewed_at", "review_note"],
  },
  brand_sources: {
    status: same("pending", "extracting", "extracted", "partial", "failed"),
    why: PIPELINE,
  },
  brand_examples: {
    other: ["verdict"],
    why: "a curated example only guides wording; it releases nothing",
  },
  brand_check_issue_states: { drop: true },
  brand_book_exports: {
    status: demote(
      ["draft", "approved", "exported", "superseded"],
      "draft",
      "approved",
      "exported",
    ),
    clear: ["approved_by", "approved_at", "approval_note"],
  },
  memory_items: {
    status: demote(
      ["observed", "candidate", "approved", "rejected", "archived"],
      "candidate",
      "approved",
    ),
    clear: DECIDED,
  },
  products: {
    status: same("draft", "proposed", "approved", "rejected", "archived"),
    clear: ["approved_by", "approved_at", "approval_note"],
  },
  product_images: { status: same("draft", "approved"), clear: ["approved_by"] },
  product_field_proposals: {
    status: same("proposed", "accepted", "rejected", "stale"),
    clear: DECIDED,
  },
  product_import_items: {
    status: same("pending", "accepted", "approved", "merged", "discarded"),
    clear: DECIDED,
  },
  product_imports: {
    status: same(
      "uploading",
      "analyzing",
      "needs_mapping",
      "ready_for_review",
      "completed",
      "partial",
      "failed",
      "cancelled",
    ),
    why: PIPELINE,
  },
};

export interface TrustTable {
  name: string;
  columns: { name: string; notNull: boolean; enumValues?: readonly string[] }[];
}

/** The client tables of the real schema, as the coverage check needs them. */
export function trustTables(): TrustTable[] {
  const names = new Set(clientTables().map((t) => t.name));
  return (Object.values(schema) as unknown[])
    .filter((v): v is PgTable => v instanceof PgTable)
    .map((t) => getTableConfig(t))
    .filter((c) => names.has(c.name))
    .map((c) => ({
      name: c.name,
      columns: c.columns.map((col) => ({
        name: col.name,
        notNull: col.notNull,
        enumValues: (col as { enumValues?: readonly string[] }).enumValues,
      })),
    }));
}

/** Throws, naming every gap at once, unless each rule says what to do with every gate column. */
export function checkTrustCoverage(
  rules: Record<string, TrustRule>,
  tables: readonly TrustTable[],
): void {
  const problems: string[] = [];
  const known = new Set(tables.map((t) => t.name));
  for (const name of Object.keys(rules))
    if (!known.has(name)) problems.push(`${name}: rule for a table that is not a client table`);
  for (const t of tables) {
    const gates = t.columns.filter((c) => GATE.test(c.name)).map((c) => c.name);
    const rule = rules[t.name];
    if (!rule) {
      // A table of exports or approvals is a record of a release even when no column says so.
      if (gates.length || /export|approval/.test(t.name))
        problems.push(`${t.name}: no trust rule (${gates.join(", ") || "table name"})`);
      continue;
    }
    if (rule.drop) continue;
    const col = new Map(t.columns.map((c) => [c.name, c]));
    const handled = new Set<string>(rule.other ?? []);
    for (const name of [
      ...(rule.other ?? []),
      ...(rule.clear ?? []),
      ...Object.keys(rule.set ?? {}),
    ])
      if (!col.has(name)) problems.push(`${t.name}.${name}: no such column`);
    for (const name of rule.clear ?? []) {
      handled.add(name);
      if (col.get(name)?.notNull) problems.push(`${t.name}.${name}: cleared but NOT NULL`);
    }
    for (const name of Object.keys(rule.set ?? {})) handled.add(name);
    const status = col.get("status");
    if (rule.status) {
      handled.add("status");
      const values = status?.enumValues;
      if (!values) problems.push(`${t.name}: status map but no status enum`);
      else {
        for (const v of values)
          if (!(v in rule.status)) problems.push(`${t.name}.status: no target for "${v}"`);
        for (const [from, target] of Object.entries(rule.status)) {
          if (!values.includes(from)) problems.push(`${t.name}.status: "${from}" is not a value`);
          if (!values.includes(target))
            problems.push(`${t.name}.status: "${target}" is not a value`);
        }
      }
    } else if (status?.enumValues) problems.push(`${t.name}.status: no status map`);
    for (const g of gates)
      if (!handled.has(g)) problems.push(`${t.name}.${g}: not covered by the trust rule`);
    const changes =
      (rule.clear?.length ?? 0) > 0 ||
      rule.set !== undefined ||
      rule.custom !== undefined ||
      Object.entries(rule.status ?? {}).some(([from, target]) => from !== target);
    if (!changes && !rule.why) problems.push(`${t.name}: changes nothing, so it needs a "why"`);
  }
  if (problems.length)
    throw new Error(`client-transfer trust rules are incomplete:\n${problems.join("\n")}`);
}

checkTrustCoverage(TRUST_RULES, trustTables());

export function applyImportTrust(table: string, row: Row, ctx: TrustContext): Row | null {
  const rule = TRUST_RULES[table];
  if (!rule) return row; // no gate column (checked at load)
  if (rule.drop) return null;
  let out: Row = { ...row };
  if (rule.status && row.status !== undefined && (!rule.when || rule.when(row))) {
    const target = rule.status[String(row.status)];
    // A status this version does not know cannot be proven harmless.
    if (target === undefined)
      throw new UnsafePackageError(`unknown status "${String(row.status)}" in ${table}`);
    out.status = target;
  }
  for (const c of rule.clear ?? []) out[c] = null;
  if (rule.set) out = { ...out, ...structuredClone(rule.set) };
  return rule.custom ? rule.custom(out, ctx) : out;
}
