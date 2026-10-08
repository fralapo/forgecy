/**
 * What an imported row is allowed to claim (ADR 0015). A package is written by someone else,
 * so a row that says "approved by Ada" or "published" is a claim, not a fact in this
 * installation. Anything that unlocks export, publication, AI use or autonomous runs comes in
 * a state that a person here has to move forward again, and no approval is attributed to a
 * person (people are matched by email, which a package can forge).
 *
 * Fail closed: every client table with a status, approval, publication or export column needs
 * a rule below, every value of a status enum needs a target, and every such column must be
 * named by the rule, and every JSON column has to have been looked at for approvals embedded in
 * it. `checkTrustCoverage` runs in a unit test and before every import (`assertTrustRules`), so
 * a new table, a new status value, a new approval column or a new JSON column stops the importer
 * until somebody decides what it means (same idea as SOFT_REFS in graph.ts; it does not run when
 * the module loads, so a schema change cannot take export or verify down).
 * Pure: returns a copy; null drops the row.
 */
import { isSensitiveMemoryCategory, sendableAssetTypes, type MemoryCategory } from "@forgecy/core";
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
  /** The installation's AI policy for new clients (what an Admin chose in the AI settings). */
  defaultAiPolicy: string;
}

export interface TrustRule {
  /** The row is not imported. */
  drop?: true;
  /** The `status` column: every value of its enum mapped to what it becomes (itself = kept). */
  status?: Record<string, string>;
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

/**
 * Columns that carry an approval, a decision, an attestation, a publication or an export, or a
 * state a gate reads, found by name. A new column of this kind without a rule is reported.
 */
const GATE =
  /^(status|decision|verdict|self_approval|ai_policy|approved_providers|sendable_assets|delivered_at|rights|editor_ids|changes_requested)$|approv|publish|export|accept|confirm|acknowledg|decision|resolved|waiv|share|enabled|(^|_)token(_|$)|(^|_)public(_|$)|(^|_)lock|^decided_|^reviewed_|^reviewer_id$|^submit|^review_/;

/** Whatever its name, an enum with one of these values says that somebody agreed to something. */
const GATE_VALUES = [
  "approved",
  "published",
  "accepted",
  "exported",
  "active",
  "confirmed",
  "verified",
];

const isGate = (c: { name: string; enumValues?: readonly string[] }): boolean =>
  GATE.test(c.name) || !!c.enumValues?.some((v) => GATE_VALUES.includes(v));

const AI_POLICY_ORDER = ["no_ai", "local_only", "external_restricted", "external_allowed"];

/**
 * The stricter of two AI policies. A value that is not a policy (a package written by something
 * else) loses against the installation's own choice.
 */
export function stricterAiPolicy(fromPackage: unknown, installationDefault: string): string {
  const a = AI_POLICY_ORDER.indexOf(String(fromPackage));
  const b = AI_POLICY_ORDER.indexOf(installationDefault);
  if (b < 0) return "no_ai"; // not even the installation's value is known: nothing may be sent
  return a >= 0 && a < b ? AI_POLICY_ORDER[a]! : installationDefault;
}

const same = (...values: string[]): Record<string, string> =>
  Object.fromEntries(values.map((v) => [v, v]));
/** `same(all)` with some values sent to `target`. */
const demote = (all: string[], target: string, ...from: string[]): Record<string, string> => ({
  ...same(...all),
  ...Object.fromEntries(from.map((v) => [v, target])),
});

const DECIDED = ["decided_by", "decided_at"];
const DECISION = [...DECIDED, "decision_note"];
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
        : {
            ...r,
            // A package cannot widen what this installation gives a new client.
            ai_policy: stricterAiPolicy(r.ai_policy, c.defaultAiPolicy),
            approved_providers: [],
            sendable_assets: [...sendableAssetTypes],
          },
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
    // The job that held the lock is not in the package: the importer empties the column.
    other: ["locked_by_job_id"],
  },
  content_approvals: { drop: true },
  content_exports: { drop: true },
  content_creative_directions: {
    status: { proposed: "proposed", accepted: "proposed", rejected: "stale", stale: "stale" },
    clear: DECISION,
  },
  content_comments: {
    clear: ["resolved_by", "resolved_at"],
  },
  content_pillars: { status: same(...STRATEGY_STATUS), clear: DECISION },
  content_rubrics: { status: same(...STRATEGY_STATUS), clear: DECISION },
  content_plan_items: { status: same(...STRATEGY_STATUS), clear: DECISION },
  content_plans: {
    status: same("proposed", "active", "superseded"),
    clear: ["accepted_by", "accepted_at"],
  },
  content_slide_edits: {
    status: same("queued", "applied", "kept", "reverted", "failed"),
    why: "record of edits on a carousel that is a draft",
  },
  assets: {
    status: demote(["draft", "approved", "rejected"], "draft", "approved"),
    // Every image is a draft until a person here approves it: a carousel is held back by an
    // unapproved image, so an approval that came with the package would skip that check.
    // Nobody here confirmed the right to use an upload commercially; the package says somebody did.
    clear: [...DECIDED, "rights"],
    // Nor did anybody here review the provider's terms for an AI image.
    custom: (r) => {
      const g = r.generation as { commercialUse?: unknown } | null | undefined;
      const out =
        g && typeof g === "object" && g.commercialUse === "verified"
          ? { ...r, generation: { ...g, commercialUse: "pending_verification" } }
          : r;
      // A product photo comes from the client's own catalog and needs no rights check; a
      // package could label any upload that way. Without a product of the package behind it,
      // it is an upload (its rights are already cleared).
      return out.source === "product" && !out.product_id ? { ...out, source: "upload" } : out;
    },
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
    status: {
      ...demote(
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
      ),
      delivered: "archived",
    },
    clear: [
      "reviewed_by",
      "reviewed_at",
      "delivered_at",
      "competitors_confirmed_by",
      "competitors_confirmed_at",
    ],
    // "Continue without competitors" alone satisfies the readiness check for the list.
    set: { competitors_skipped: false },
    // Delivered means it went out to a prospect from the other installation. It cannot become
    // active again: only one audit per client may be (audits_one_active_uq).
    custom: (r) =>
      r.status === "archived" && !r.archived_at
        ? { ...r, archived_at: new Date().toISOString() }
        : r,
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
      "changes_requested",
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
  audit_competitors: {
    status: same("proposed", "confirmed", "removed"),
    clear: ["confirmed_by", "confirmed_at"],
  },
  audit_findings: {
    status: same("observed", "accepted", "edited", "rejected"),
    // "Edited by a person" is a claim about who wrote it.
    set: { edited_by_human: false },
  },
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
    // Ids of people of the other installation, and checks somebody there confirmed.
    set: { editor_ids: [], acknowledged_checks: [] },
    // Archived, so that a person can restore it as a new draft.
    custom: (r) => {
      const out: Row = { ...r, document: resetFontLicenses(r.document) };
      return out.status === "archived" && !out.archived_at
        ? { ...out, archived_at: new Date().toISOString() }
        : out;
    },
  },
  brand_identity_proposals: {
    status: { proposed: "proposed", accepted: "stale", rejected: "stale", stale: "stale" },
    // model_confidence is what the model said of itself: informative only, dropped.
    clear: ["reviewed_by", "reviewed_at", "review_note", "model_confidence"],
    // What the proposal says about itself decides whether it needs a note and a closer look:
    // a package gets the cautious values.
    set: { sensitive: true, confidence: "low" },
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
  // The newest run is what decides whether Brand Guard is re-run before an approval; its
  // created_at comes from the package, so a clean "latest" run could be supplied.
  brand_check_runs: { drop: true },
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
    clear: DECISION,
    // Bulk approval skips sensitive memories; the package does not get to say which are.
    custom: (r) =>
      typeof r.category === "string"
        ? { ...r, sensitive: isSensitiveMemoryCategory(r.category as MemoryCategory) }
        : r,
  },
  products: {
    // Which fields carry a sensitive claim is written by the package and cannot be recomputed
    // here (that is the catalog's job), so no product arrives approved: a person approves it
    // again and the catalog's own blockers apply.
    status: demote(
      ["draft", "proposed", "approved", "rejected", "archived"],
      "proposed",
      "approved",
    ),
    clear: ["approved_by", "approved_at", "approval_note"],
    // A person's acceptance of a sensitive claim is what lets a product be approved: forgotten.
    custom: (r) => ({ ...r, field_meta: stripAcceptance(r.field_meta).meta }),
  },
  product_images: { status: same("draft", "approved"), clear: ["approved_by"] },
  product_field_proposals: {
    status: same("proposed", "accepted", "rejected", "stale"),
    clear: DECIDED,
  },
  product_import_items: {
    // Accepted, not yet merged: accepted again here (the claims are not recomputed, see products).
    status: demote(
      ["pending", "accepted", "approved", "merged", "discarded"],
      "pending",
      "accepted",
    ),
    clear: DECIDED,
    // Per-field choices a person made on conflicts elsewhere.
    set: { conflict_decisions: {} },
    // "Sensitive" means a claim waits for acceptance; with the acceptances gone it is derived
    // the way the review does (review.ts): any field that carries a claim.
    custom: (r) => {
      const { meta, sensitive } = stripAcceptance(r.field_meta);
      return { ...r, field_meta: meta, sensitive };
    },
  },
  product_import_files: {
    clear: ["mapping_confirmed_by", "mapping_confirmed_at"],
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
    // A person's confirmation to send the files to an AI provider belongs to that run only,
    // and "official" (the files are the client's own documents) is a claim of the package.
    custom: (r) => {
      const o = r.options;
      if (!o || typeof o !== "object") return r;
      const { aiConfirmed: _a, aiConfirmedBy: _b, official: _o, ...rest } = o as Row;
      return { ...r, options: rest };
    },
  },
};

type Meta = Record<string, unknown>;

/**
 * Field metadata without who accepted a sensitive claim and with no field "approved" (the
 * approval of a product or an import item is not imported), and whether any field carries a claim.
 */
function stripAcceptance(fieldMeta: unknown): { meta: Meta; sensitive: boolean } {
  const meta: Meta = {};
  let sensitive = false;
  if (fieldMeta && typeof fieldMeta === "object")
    for (const [field, entry] of Object.entries(fieldMeta as Meta)) {
      if (!entry || typeof entry !== "object") {
        meta[field] = entry;
        continue;
      }
      const { acceptedBy: _by, acceptedAt: _at, acceptNote: _note, ...rest } = entry as Meta;
      if (Array.isArray(rest.sensitive) && rest.sensitive.length) sensitive = true;
      meta[field] = rest.truth === "approved" ? { ...rest, truth: "proposed" } : rest;
    }
  return { meta, sensitive };
}

/** A brand document with every font license back to "to verify" (a person here checks it). */
function resetFontLicenses(document: unknown): unknown {
  const doc = document as { visual?: { typography?: unknown } } | null;
  const typography = doc?.visual?.typography;
  if (!doc || !Array.isArray(typography)) return document;
  return {
    ...doc,
    visual: {
      ...doc.visual,
      typography: typography.map((t: { value?: Meta }) =>
        t?.value && typeof t.value === "object"
          ? { ...t, value: { ...t.value, licenseStatus: "to_verify" } }
          : t,
      ),
    },
  };
}

export interface TrustTable {
  name: string;
  columns: { name: string; notNull: boolean; enumValues?: readonly string[]; json?: boolean }[];
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
        json: col.columnType === "PgJsonb",
      })),
    }));
}

/** Throws, naming every gap at once, unless each rule says what to do with every gate column. */
export function checkTrustCoverage(
  rules: Record<string, TrustRule>,
  tables: readonly TrustTable[],
  reviewedJson: ReadonlySet<string> = REVIEWED_JSON_COLUMNS,
): void {
  const problems: string[] = [];
  const known = new Set(tables.map((t) => t.name));
  for (const name of Object.keys(rules))
    if (!known.has(name)) problems.push(`${name}: rule for a table that is not a client table`);
  for (const t of tables)
    for (const c of t.columns)
      if (c.json && !reviewedJson.has(`${t.name}.${c.name}`))
        problems.push(
          `${t.name}.${c.name}: JSON column not reviewed for embedded approvals (REVIEWED_JSON_COLUMNS)`,
        );
  for (const t of tables) {
    const gates = t.columns.filter(isGate).map((c) => c.name);
    const rule = rules[t.name];
    if (!rule) {
      // A table of exports or approvals is a record of a release even when no column says so.
      if (gates.length || /export|approval|check_/.test(t.name))
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

let checked = false;
/**
 * Checks the rules against the real schema, once. The importer calls it before it reads a
 * package, so a schema change stops imports without taking export or verify down; a unit test
 * calls `checkTrustCoverage` itself.
 */
export function assertTrustRules(): void {
  if (checked) return;
  checkTrustCoverage(TRUST_RULES, trustTables());
  checked = true;
}

/**
 * Unique indexes whose predicate reads a status, per client table. A status mapping may move a
 * row out of such an index but never into it: two rows that were allowed side by side in the
 * package (one delivered, one reviewed) could otherwise collide once both are mapped to the
 * same status, and the import would fail on a constraint. A test lists the partial unique
 * indexes of the schema and fails for one that is in neither this list nor NOT_STATUS_DEPENDENT.
 */
export const STATUS_UNIQUE_INDEXES: Record<
  string,
  { table: string; inside: (status: string) => boolean }
> = {
  audits_one_active_uq: {
    table: "audits",
    inside: (s) => s !== "delivered" && s !== "archived",
  },
  brand_versions_one_published_uq: {
    table: "brand_identity_versions",
    inside: (s) => s === "published",
  },
  brand_versions_one_open_uq: {
    table: "brand_identity_versions",
    inside: (s) => s === "draft" || s === "in_review",
  },
  content_plans_active_uq: { table: "content_plans", inside: (s) => s === "active" },
};

/**
 * Every JSON column of the client tables, looked at for approvals or attestations embedded in it
 * (a person's name, "accepted", "confirmed", "verified"). A new JSON column fails the coverage
 * check until it is added here, with a rule above if it holds one. Those that did:
 * products.field_meta and product_import_items.field_meta (acceptance of sensitive claims),
 * product_imports.options (confirmation to use AI), assets.rights and assets.generation (rights
 * and commercial-use review), brand_identity_versions.document (font license status),
 * editor_ids, acknowledged_checks and conflict_decisions (reset to empty), and the template
 * references of content_versions.meta (templates.ts). The rest was read and holds data only.
 */
export const REVIEWED_JSON_COLUMNS: ReadonlySet<string> = new Set([
  "prospect_profiles.objectives",
  "prospect_profiles.social_urls",
  "audits.inputs",
  "site_scans.steps",
  "site_scans.robots",
  "site_scans.extracted",
  "site_scans.error_ref",
  "audit_sources.data",
  "audit_sources.skip_ref",
  "audit_channels.unavailable_ref",
  "audit_social_posts.metrics",
  "audit_competitors.removed_ref",
  "audit_competitors.source_error_ref",
  "audit_findings.confidence_ref",
  "audit_findings.evidence",
  "audit_findings.comparison",
  "audit_findings.ai_meta",
  "audit_plans.pillars",
  "audit_plans.items",
  "audit_plans.ai_meta",
  "audit_reports.sections",
  "audit_reports.ai_meta",
  "templates.manifest",
  "templates.validation",
  "brand_identity_versions.document",
  "brand_identity_versions.tokens",
  "brand_identity_versions.editor_ids",
  "brand_identity_versions.acknowledged_checks",
  "brand_sources.status_detail_ref",
  "brand_sources.pages",
  "brand_identity_proposals.title_ref",
  "brand_identity_proposals.changes",
  "brand_identity_proposals.rationale_ref",
  "brand_identity_proposals.evidence",
  "brand_identity_proposals.checks",
  "brand_identity_proposals.edited_value",
  "brand_identity_proposals.stale_ref",
  "content_pillars.examples",
  "content_pillars.provenance",
  "content_rubrics.structure",
  "content_rubrics.provenance",
  "content_plans.provenance",
  "content_plan_items.provenance",
  "contents.brief",
  "contents.outline",
  "contents.draft",
  "content_versions.document",
  "content_versions.meta",
  "content_outlines.outline",
  "content_creative_directions.direction",
  "content_creative_directions.provenance",
  "content_slide_edits.before",
  "content_slide_edits.after",
  "content_slide_edits.note_ref",
  "content_approvals.acknowledged",
  "content_exports.files",
  "assets.generation",
  "assets.rights",
  "product_imports.options",
  "product_imports.summary",
  "product_import_files.meta",
  "product_import_files.mapping",
  "product_import_files.mapping_proposal",
  "product_import_files.suggestion",
  "product_column_mappings.mapping",
  "products.details",
  "products.field_meta",
  "products.origin",
  "product_field_proposals.current_value",
  "product_field_proposals.proposed_value",
  "product_field_proposals.meta",
  "product_import_items.draft",
  "product_import_items.field_meta",
  "product_import_items.origin",
  "product_import_items.images",
  "product_import_items.match_ref",
  "product_import_items.conflicts",
  "product_import_items.conflict_decisions",
  "product_import_items.discard_ref",
  "brand_check_runs.report",
  "brand_book_exports.parts",
  "automations.status_reason",
  "automations.params",
  "automations.items",
  "automation_run_items.input",
  "automation_run_items.error_ref",
  "client_memory_settings.value",
]);

/** Partial unique indexes and constraints that the status mappings cannot affect. */
export const NOT_STATUS_DEPENDENT = new Set([
  "brand_sources_file_uq", // a file hash of a source that is not removed
  "brand_check_states_uq", // brand_check_issue_states: its rows are not imported
]);

/**
 * Package files that only a dropped row (an export record) uses: they would be copied into
 * storage with nothing pointing at them. `fileKeys` are the keys as they will be stored, the
 * texts are the rows (as JSON) after the remap.
 */
export function unreferencedExportFiles(
  fileKeys: readonly string[],
  droppedTexts: readonly string[],
  keptTexts: readonly string[],
): Set<string> {
  const kept = keptTexts.join("\n");
  return new Set(
    fileKeys.filter((k) => droppedTexts.some((t) => t.includes(k)) && !kept.includes(k)),
  );
}

export function applyImportTrust(table: string, row: Row, ctx: TrustContext): Row | null {
  const rule = TRUST_RULES[table];
  if (!rule) return row; // no gate column (assertTrustRules)
  if (rule.drop) return null;
  let out: Row = { ...row };
  if (rule.status && row.status !== undefined) {
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
