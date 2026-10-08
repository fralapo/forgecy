/**
 * Which tables belong to a client, read from the Drizzle schema: a table is part of the
 * client when it has a foreign key to the client or to another table of the client.
 * New module tables are picked up on their own; each one needs an area below
 * (a test fails otherwise), so nobody adds a table that silently never travels.
 */
import type { ClientTransferArea } from "@forgecy/core";
import { schema } from "@forgecy/db";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

export interface ForeignKey {
  column: string;
  target: string;
  notNull: boolean;
}

/**
 * A uuid column that holds the id of another row without a declared foreign key.
 * `package`: the row must travel in the package (checked, and remapped on import).
 * `nullIfOutside`: may point at something that does not travel (a job, an agency
 * template); the import empties it unless it points at a row of the package.
 */
export interface SoftRef {
  column: string;
  target: string;
  notNull: boolean;
  mode: "package" | "nullIfOutside";
}

export interface ClientTable {
  name: string;
  area: ClientTransferArea | "client";
  /** Rows are selected by this column (`client_id`) or through `parents`. */
  hasClientId: boolean;
  columns: string[];
  /** Foreign keys to other tables of the client. */
  parents: ForeignKey[];
  /** Foreign keys to people: mapped by email on import, else emptied. */
  userColumns: ForeignKey[];
  /** Foreign keys to tables that never travel (jobs): emptied on import. */
  droppedColumns: ForeignKey[];
  /** uuid columns that point at rows without a foreign key (see SOFT_REFS). */
  softRefs: SoftRef[];
}

/** Never in a package: people, sessions, settings, the job queue, budgets, history of this install. */
export const EXCLUDED_TABLES = new Set([
  "users",
  "sessions",
  "accounts",
  "verifications",
  "app_settings",
  "audit_events",
  "jobs",
  "jobs_log",
  "ai_connections",
  "budgets",
  "mcp_connections",
  "notifications",
  "client_exports",
  "client_imports",
]);

/** Area of every client table (spec page 68: what the package contains). */
export const TABLE_AREAS: Record<string, ClientTransferArea | "client"> = {
  clients: "client",
  brand_identities: "brand",
  brand_identity_versions: "brand",
  brand_identity_proposals: "brand",
  brand_sources: "brand",
  brand_examples: "brand",
  brand_check_runs: "brand",
  brand_check_issue_states: "brand",
  brand_book_exports: "brandBook",
  templates: "templates",
  prospect_profiles: "audit",
  audits: "audit",
  audit_channels: "audit",
  audit_competitors: "audit",
  audit_findings: "audit",
  audit_metrics: "audit",
  audit_plans: "audit",
  audit_reports: "audit",
  audit_social_posts: "audit",
  audit_sources: "audit",
  site_scans: "audit",
  audit_report_exports: "reports",
  assets: "content",
  contents: "content",
  content_approvals: "content",
  content_comments: "content",
  content_exports: "content",
  content_outlines: "content",
  content_creative_directions: "content",
  content_pillars: "content",
  content_plan_items: "content",
  content_plans: "content",
  content_rubrics: "content",
  content_slide_edits: "content",
  content_versions: "content",
  automations: "content",
  automation_runs: "content",
  automation_run_items: "content",
  products: "products",
  product_column_mappings: "products",
  product_field_proposals: "products",
  product_images: "products",
  product_import_files: "products",
  product_import_items: "products",
  product_imports: "products",
  memory_items: "client",
  memory_item_versions: "client",
  client_memory_settings: "client",
};

/**
 * Every uuid column of a client table that is neither `id` nor a foreign key, with the table
 * it points to. A new one without an entry makes `clientTables()` fail, so nobody adds a
 * reference that an import would silently leave pointing at another client's data.
 * `brand_check_*.subject_id` is generic (`subject_type`); the only subject today is a carousel.
 * A new subject type needs a per-type target here (and in the checks), not another contents entry.
 */
export const SOFT_REFS: Record<string, { target: string; mode: SoftRef["mode"] }> = {
  "contents.product_id": { target: "products", mode: "package" },
  "assets.product_id": { target: "products", mode: "package" },
  "brand_examples.content_version_id": { target: "content_versions", mode: "package" },
  "brand_check_runs.subject_id": { target: "contents", mode: "package" },
  "brand_check_issue_states.subject_id": { target: "contents", mode: "package" },
  "audit_reports.template_id": { target: "templates", mode: "nullIfOutside" },
  "brand_identity_proposals.run_id": { target: "jobs", mode: "nullIfOutside" },
};

function allTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((v): v is PgTable => v instanceof PgTable);
}

let cached: ClientTable[] | null = null;

/**
 * The client's tables, parents before children. Foreign keys that point forward in
 * this order (cycles, such as contents ↔ content_versions) are nullable: the import
 * writes them in a second pass.
 */
export function clientTables(): ClientTable[] {
  if (cached) return cached;
  const configs = allTables().map((t) => getTableConfig(t));
  const included = new Set<string>(["clients"]);
  // Fixed point: a table joins when one of its foreign keys points to a joined table.
  for (let grew = true; grew;) {
    grew = false;
    for (const c of configs) {
      if (included.has(c.name) || EXCLUDED_TABLES.has(c.name)) continue;
      if (
        c.foreignKeys.some((f) => included.has(getTableConfig(f.reference().foreignTable).name))
      ) {
        included.add(c.name);
        grew = true;
      }
    }
  }
  const tables = configs
    .filter((c) => included.has(c.name))
    .map((c): ClientTable => {
      const area = TABLE_AREAS[c.name];
      if (!area) throw new Error(`Table ${c.name} has no area in client-transfer TABLE_AREAS`);
      const notNull = new Map(c.columns.map((col) => [col.name, col.notNull]));
      const fks = c.foreignKeys.flatMap((f) => {
        const ref = f.reference();
        const target = getTableConfig(ref.foreignTable).name;
        return ref.columns.map((col) => ({
          column: col.name,
          target,
          notNull: notNull.get(col.name) ?? false,
        }));
      });
      return {
        name: c.name,
        area,
        hasClientId: c.name !== "clients" && notNull.has("client_id"),
        columns: c.columns.map((col) => col.name),
        parents: fks.filter((f) => included.has(f.target)),
        userColumns: fks.filter((f) => f.target === "users"),
        droppedColumns: fks.filter((f) => !included.has(f.target) && f.target !== "users"),
        softRefs: c.columns
          .filter(
            (col) =>
              col.columnType === "PgUUID" &&
              col.name !== "id" &&
              !fks.some((f) => f.column === col.name),
          )
          .map((col): SoftRef => {
            const soft = SOFT_REFS[`${c.name}.${col.name}`];
            if (!soft)
              throw new Error(`Column ${c.name}.${col.name} has no entry in client-transfer SOFT_REFS`);
            return { column: col.name, notNull: col.notNull, ...soft };
          }),
      };
    });

  // Topological order on the NOT NULL foreign keys (nullable ones may point forward).
  const byName = new Map(tables.map((t) => [t.name, t]));
  const ordered: ClientTable[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (t: ClientTable) => {
    if (state.get(t.name) === "done") return;
    if (state.get(t.name) === "visiting")
      throw new Error(`NOT NULL foreign key cycle at ${t.name}`);
    state.set(t.name, "visiting");
    for (const p of t.parents) if (p.notNull && p.target !== t.name) visit(byName.get(p.target)!);
    state.set(t.name, "done");
    ordered.push(t);
  };
  for (const t of [...tables].sort((a, b) => a.name.localeCompare(b.name))) visit(t);
  cached = ordered;
  return ordered;
}
