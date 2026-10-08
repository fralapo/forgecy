import { describe, expect, it } from "vitest";
import {
  applyImportTrust,
  checkTrustCoverage,
  TRUST_RULES,
  trustTables,
  type TrustContext,
} from "../src/trust";

const ctx: TrustContext = { clientId: "c-new", existing: null };

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
    expect(applyImportTrust("clients", row, ctx)).toMatchObject({ approved_providers: [] });
    expect(
      applyImportTrust("clients", row, {
        clientId: "c",
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
    ).toMatchObject({ status: "in_review", reviewed_by: null, delivered_at: null });
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
