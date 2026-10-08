import { schema } from "@forgecy/db";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { clientTables } from "../src/graph";
import {
  applyImportTrust,
  checkTrustCoverage,
  NOT_STATUS_DEPENDENT,
  STATUS_UNIQUE_INDEXES,
  stricterAiPolicy,
  TRUST_RULES,
  trustTables,
  unreferencedExportFiles,
  type TrustContext,
  type TrustTable,
} from "../src/trust";

const ctx: TrustContext = {
  clientId: "c-new",
  existing: null,
  defaultAiPolicy: "external_allowed",
};

describe("applyImportTrust", () => {
  it("brings content back as a draft and forgets who approved it", () => {
    for (const status of ["in_review", "changes_requested", "approved", "exported"]) {
      const out = applyImportTrust(
        "contents",
        {
          id: "x",
          status,
          approved_version_id: "v1",
          outline_approved_by: "u1",
          reviewer_id: "u2",
        },
        ctx,
      )!;
      expect(out).toMatchObject({
        status: "draft",
        approved_version_id: null,
        outline_approved_by: null,
        reviewer_id: null,
      });
    }
    expect(applyImportTrust("contents", { id: "x", status: "archived" }, ctx)!.status).toBe(
      "archived",
    );
  });
  it("does not mutate its input", () => {
    const row = { id: "x", status: "approved" };
    applyImportTrust("contents", row, ctx);
    expect(row.status).toBe("approved");
  });
  it("drops approval records, export records and waivers", () => {
    expect(applyImportTrust("content_approvals", { id: "a", decided_by: "u" }, ctx)).toBeNull();
    expect(applyImportTrust("content_exports", { id: "e", draft: false }, ctx)).toBeNull();
    expect(applyImportTrust("audit_report_exports", { id: "e", final: true }, ctx)).toBeNull();
    expect(
      applyImportTrust("brand_check_issue_states", { id: "w", status: "ignored" }, ctx),
    ).toBeNull();
  });
  it("makes every template a draft that belongs to the client, never a system one", () => {
    for (const status of ["draft", "in_review", "approved", "published", "archived"])
      expect(
        applyImportTrust(
          "templates",
          {
            id: "t",
            status,
            origin: "system",
            client_id: null,
            published_by: "u",
            validation: { ok: true },
          },
          ctx,
        ),
      ).toMatchObject({
        status: "draft",
        origin: "agency",
        client_id: "c-new",
        published_by: null,
        validation: {},
      });
  });
  it("does not import AI consent; a replacement keeps the replaced client's own", () => {
    const row = {
      id: "c",
      ai_policy: "external_allowed",
      approved_providers: ["openai"],
      sendable_assets: ["documents"],
    };
    expect(applyImportTrust("clients", row, ctx)).toMatchObject({
      approved_providers: [],
      sendable_assets: [
        "brand_assets",
        "client_photos",
        "audit_screenshots",
        "documents",
        "brand_texts",
      ],
    });
    expect(
      applyImportTrust("clients", row, {
        clientId: "c",
        defaultAiPolicy: "external_allowed",
        existing: {
          aiPolicy: "local_only",
          approvedProviders: [],
          sendableAssets: ["brand_texts"],
        },
      }),
    ).toMatchObject({
      ai_policy: "local_only",
      approved_providers: [],
      sendable_assets: ["brand_texts"],
    });
  });
  it("gives a new client the stricter of the package's AI policy and the installation's", () => {
    const order = ["no_ai", "local_only", "external_restricted", "external_allowed"];
    for (const policy of order)
      for (const fallback of order) {
        const out = applyImportTrust(
          "clients",
          { id: "c", ai_policy: policy },
          { ...ctx, defaultAiPolicy: fallback },
        )!;
        expect(order.indexOf(String(out.ai_policy))).toBe(
          Math.min(order.indexOf(policy), order.indexOf(fallback)),
        );
      }
    // Something that is not a policy never beats the installation's own value.
    expect(stricterAiPolicy("anything", "local_only")).toBe("local_only");
    expect(stricterAiPolicy(undefined, "external_restricted")).toBe("external_restricted");
    expect(stricterAiPolicy("external_allowed", "nonsense")).toBe("no_ai");
  });
  it("demotes approved AI images, active automations, approved memories, reports and brand versions", () => {
    expect(
      applyImportTrust("assets", { source: "ai", status: "approved", decided_by: "u" }, ctx),
    ).toMatchObject({ status: "draft", decided_by: null });
    expect(applyImportTrust("assets", { source: "upload", status: "approved" }, ctx)!.status).toBe(
      "approved",
    );
    expect(applyImportTrust("automations", { status: "active" }, ctx)!.status).toBe("paused");
    expect(
      applyImportTrust("memory_items", { status: "approved", decided_by: "u" }, ctx),
    ).toMatchObject({ status: "candidate", decided_by: null });
    expect(
      applyImportTrust("audit_reports", { status: "exported", approved_by: "u" }, ctx),
    ).toMatchObject({ status: "draft", approved_by: null });
    expect(applyImportTrust("brand_identity_versions", { status: "published" }, ctx)).toMatchObject(
      { status: "archived" },
    );
    expect(
      applyImportTrust("brand_identity_versions", { status: "in_review", submitted_by: "u" }, ctx),
    ).toMatchObject({ status: "draft", submitted_by: null });
    expect(
      applyImportTrust("brand_book_exports", { status: "approved", approved_by: "u" }, ctx),
    ).toMatchObject({ status: "draft", approved_by: null });
  });
  it("archives an approved brand version with an archive date and no approver", () => {
    const out = applyImportTrust(
      "brand_identity_versions",
      { status: "approved", approved_by: "u", approved_at: "2026-01-01", published_by: "u" },
      ctx,
    )!;
    expect(out).toMatchObject({
      status: "archived",
      approved_by: null,
      approved_at: null,
      published_by: null,
    });
    expect(typeof out.archived_at).toBe("string");
  });
  it("sends audits back to review, and runs that were going back to cancelled", () => {
    expect(
      applyImportTrust("audits", { status: "delivered", reviewed_by: "u", delivered_at: "x" }, ctx),
    ).toMatchObject({ status: "archived", reviewed_by: null, delivered_at: null });
    expect(applyImportTrust("audits", { status: "reviewed", reviewed_by: "u" }, ctx)).toMatchObject(
      {
        status: "in_review",
        reviewed_by: null,
      },
    );
    expect(applyImportTrust("automation_runs", { status: "running" }, ctx)!.status).toBe(
      "cancelled",
    );
    expect(applyImportTrust("automation_run_items", { status: "queued" }, ctx)!.status).toBe(
      "cancelled",
    );
    expect(
      applyImportTrust("content_creative_directions", { status: "accepted", decided_by: "u" }, ctx),
    ).toMatchObject({ status: "proposed", decided_by: null });
    expect(
      applyImportTrust("brand_identity_proposals", { status: "accepted", reviewed_by: "u" }, ctx),
    ).toMatchObject({ status: "stale", reviewed_by: null });
  });
  it("keeps accepted strategy but forgets who accepted it", () => {
    expect(
      applyImportTrust("content_pillars", { status: "accepted", decided_by: "u" }, ctx),
    ).toMatchObject({ status: "accepted", decided_by: null });
  });
  it("leaves tables without any approval state untouched", () => {
    const row = { id: "p", number: 1 };
    expect(applyImportTrust("content_versions", row, ctx)).toEqual(row);
  });
  it("refuses a status it has no rule for instead of letting it through", () => {
    expect(() => applyImportTrust("contents", { id: "x", status: "blessed" }, ctx)).toThrow(
      /status/,
    );
  });
});

describe("trust rules fail closed", () => {
  it("cover every client table of the real schema", () => {
    expect(() => checkTrustCoverage(TRUST_RULES, trustTables())).not.toThrow();
    expect(trustTables().length).toBeGreaterThan(30);
  });
  const widgets = (extra: object[] = []) => [
    {
      name: "widgets",
      columns: [{ name: "status", notNull: true, enumValues: ["draft", "live"] }, ...(extra as [])],
    },
  ];
  it("fails for a new table with a status and no rule", () => {
    expect(() => checkTrustCoverage({}, widgets())).toThrow(/widgets/);
  });
  it("fails for a new approval column on a table that has a rule", () => {
    const rules = { widgets: { status: { draft: "draft", live: "draft" } } };
    expect(() => checkTrustCoverage(rules, widgets())).not.toThrow();
    expect(() =>
      checkTrustCoverage(rules, widgets([{ name: "approved_by", notNull: false }])),
    ).toThrow(/approved_by/);
  });
  it("fails for a new status value, an unknown target and a rule for a missing table", () => {
    const rules = { widgets: { status: { draft: "draft" } } };
    expect(() => checkTrustCoverage(rules, widgets())).toThrow(/live/);
    expect(() =>
      checkTrustCoverage({ widgets: { status: { draft: "draft", live: "gone" } } }, widgets()),
    ).toThrow(/gone/);
    expect(() =>
      checkTrustCoverage(
        { widgets: { status: { draft: "draft", live: "draft" } }, ghost: {} },
        widgets(),
      ),
    ).toThrow(/ghost/);
  });
  it("fails when a rule clears a column that cannot be null", () => {
    const rules = { widgets: { status: { draft: "draft", live: "draft" }, clear: ["owner"] } };
    expect(() => checkTrustCoverage(rules, widgets([{ name: "owner", notNull: true }]))).toThrow(
      /owner/,
    );
    expect(() => checkTrustCoverage(rules, widgets())).toThrow(/owner/);
  });
  it("accepts a table that changes nothing only with a stated reason", () => {
    const status = { draft: "draft", live: "live" };
    expect(() => checkTrustCoverage({ widgets: { status } }, widgets())).toThrow(/why/);
    expect(() =>
      checkTrustCoverage({ widgets: { status, why: "history only" } }, widgets()),
    ).not.toThrow();
  });
});

describe("status changes keep partial unique indexes intact", () => {
  it("never leaves two active audits when a client has a delivered one and a reviewed one", () => {
    const rows = [
      { id: "a1", client_id: "c", status: "delivered" },
      { id: "a2", client_id: "c", status: "reviewed" },
      { id: "a3", client_id: "c", status: "archived" },
    ].map((r) => applyImportTrust("audits", r, ctx)!);
    const active = rows.filter((r) => !["delivered", "archived"].includes(String(r.status)));
    expect(active).toHaveLength(1);
    expect(rows[0]!.status).toBe("archived");
    expect(typeof rows[0]!.archived_at).toBe("string");
  });
  it("never moves a status from outside an index predicate into it", () => {
    for (const [name, index] of Object.entries(STATUS_UNIQUE_INDEXES)) {
      const rule = TRUST_RULES[index.table]!;
      for (const [from, target] of Object.entries(rule.status ?? {}))
        if (index.inside(target) && !index.inside(from))
          throw new Error(`${name}: ${index.table} sends "${from}" into the index as "${target}"`);
    }
  });
  it("knows every partial unique index and status-dependent unique constraint of the client tables", () => {
    const known = new Set(Object.keys(STATUS_UNIQUE_INDEXES));
    const names = new Set(clientTables().map((t) => t.name));
    const found: string[] = [];
    for (const v of Object.values(schema) as unknown[]) {
      if (!(v instanceof PgTable)) continue;
      const cfg = getTableConfig(v);
      if (!names.has(cfg.name)) continue;
      for (const idx of cfg.indexes)
        if (idx.config.unique && idx.config.where) found.push(String(idx.config.name));
      for (const u of cfg.uniqueConstraints)
        if (u.columns.some((c) => c.name === "status")) found.push(String(u.name));
    }
    // One that is in neither list has not been checked against the status mappings.
    expect(found.filter((n) => !known.has(n) && !NOT_STATUS_DEPENDENT.has(n))).toEqual([]);
    expect(found.length).toBeGreaterThan(3);
  });
});

describe("attestations inside rows", () => {
  it("forgets who confirmed an upload's rights and an AI image's commercial review", () => {
    const rights = { basis: "licensed", note: "n", confirmedBy: "u", confirmedAt: "x" };
    expect(
      applyImportTrust("assets", { source: "upload", status: "draft", rights }, ctx),
    ).toMatchObject({ rights: null });
    const ai = applyImportTrust(
      "assets",
      { source: "ai", status: "draft", generation: { commercialUse: "verified", model: "m" } },
      ctx,
    )!;
    expect(ai.generation).toEqual({ commercialUse: "pending_verification", model: "m" });
    const rejected = applyImportTrust(
      "assets",
      { source: "ai", status: "draft", generation: { commercialUse: "rejected" } },
      ctx,
    )!;
    expect(rejected.generation).toEqual({ commercialUse: "rejected" });
  });
  it("forgets confirmations, acceptances, resolutions, editors and acknowledgements", () => {
    const cleared = (table: string, row: Record<string, unknown>) =>
      applyImportTrust(table, row, ctx)!;
    expect(cleared("content_plans", { accepted_by: "u", accepted_at: "t" })).toMatchObject({
      accepted_by: null,
      accepted_at: null,
    });
    expect(
      cleared("audits", { competitors_confirmed_by: "u", competitors_confirmed_at: "t" }),
    ).toMatchObject({ competitors_confirmed_by: null, competitors_confirmed_at: null });
    expect(cleared("audit_competitors", { status: "confirmed", confirmed_by: "u" })).toMatchObject({
      confirmed_by: null,
      confirmed_at: null,
    });
    expect(cleared("product_import_files", { mapping_confirmed_by: "u" })).toMatchObject({
      mapping_confirmed_by: null,
      mapping_confirmed_at: null,
    });
    expect(cleared("content_comments", { resolved_by: "u", resolved_at: "t" })).toMatchObject({
      resolved_by: null,
      resolved_at: null,
    });
    expect(
      cleared("brand_identity_versions", { editor_ids: ["u"], acknowledged_checks: ["c"] }),
    ).toMatchObject({ editor_ids: [], acknowledged_checks: [] });
    expect(cleared("audit_reports", { changes_requested: "no" })).toMatchObject({
      changes_requested: null,
    });
    expect(cleared("memory_items", { decision_note: "ok" })).toMatchObject({ decision_note: null });
    expect(cleared("content_pillars", { decision_note: "ok" })).toMatchObject({
      decision_note: null,
    });
  });
});

describe("gate detection", () => {
  const table = (...columns: TrustTable["columns"]): TrustTable[] => [{ name: "widgets", columns }];
  const ok = { widgets: { why: "nothing here" } };
  it("reports a new approval-like column by name", () => {
    expect(() => checkTrustCoverage(ok, table({ name: "label", notNull: false }))).not.toThrow();
    for (const name of ["accepted_by", "share_token", "confirmed_at", "is_public", "rights"])
      expect(() => checkTrustCoverage(ok, table({ name, notNull: false }))).toThrow(
        new RegExp(name),
      );
  });
  it("reports an enum column that can say somebody agreed, whatever it is called", () => {
    expect(() =>
      checkTrustCoverage(ok, table({ name: "mood", notNull: true, enumValues: ["happy", "sad"] })),
    ).not.toThrow();
    expect(() =>
      checkTrustCoverage(
        ok,
        table({ name: "mood", notNull: true, enumValues: ["happy", "verified"] }),
      ),
    ).toThrow(/mood/);
  });
  it("accepts such a column once the rule names it", () => {
    expect(() =>
      checkTrustCoverage(
        { widgets: { clear: ["accepted_by"] } },
        table({ name: "accepted_by", notNull: false }),
      ),
    ).not.toThrow();
  });
});

describe("files that only a dropped export used", () => {
  it("are left out, and kept when a kept row also uses them", () => {
    const skip = unreferencedExportFiles(
      ["clients/c/a.pdf", "clients/c/b.png", "clients/c/c.png"],
      ['{"files":["clients/c/a.pdf","clients/c/b.png"]}'],
      ['{"image":"clients/c/b.png"}'],
    );
    expect([...skip]).toEqual(["clients/c/a.pdf"]);
  });
});
