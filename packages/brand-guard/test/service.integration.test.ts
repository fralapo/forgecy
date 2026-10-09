import { emptyDocument } from "@forgecy/brand/document";
import { defaultTokens } from "@forgecy/brand/tokens";
import {
  ForgecyError,
  PermissionDeniedError,
  type Actor,
  type BrandCheckIgnoreReason,
} from "@forgecy/core";
import {
  brandIdentities,
  brandIdentityVersions,
  clients,
  createDb,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  confirmBrandCheckForApproval,
  getBrandCheck,
  ignoreFinding,
  reopenFinding,
  runBrandCheck,
} from "../src/service";
import type { GuardContent } from "../src/types";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const reviewer: Actor = { type: "agent", role: "reviewer", runId: crypto.randomUUID() };

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PermissionDeniedError) return "permission_denied";
    if (err instanceof ForgecyError) return String(err.details?.code ?? err.code);
    throw err;
  }
  return "ok";
}

const carousel = (title: string): GuardContent => ({
  size: { width: 1080, height: 1350 },
  slides: [
    {
      layout: "cover",
      slots: [{ kind: "text", name: "title", label: "Title", role: "title", text: title }],
    },
    {
      layout: "cta",
      role: "cta",
      slots: [{ kind: "text", name: "cta", role: "cta", text: "Save the post" }],
    },
  ],
});

describe.skipIf(!dbUrl)("brand guard service (integration)", () => {
  let db: Database;
  let clientId: string;
  let otherClientId: string;
  let anna: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const subject = { type: "carousel", id: crypto.randomUUID(), version: 1 };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const [c, other] = await db
      .insert(clients)
      .values([
        { name: `Guard ${suffix}`, slug: `guard-test-${suffix}` },
        { name: `Guard without BI ${suffix}`, slug: `guard-test-nobi-${suffix}` },
      ])
      .returning();
    clientId = c!.id;
    otherClientId = other!.id;
    const [u] = await db
      .insert(users)
      .values({ name: "anna", email: `anna-${suffix}@example.test` })
      .returning();
    anna = { type: "user", id: u!.id, isAdmin: false, active: true, clients: "all" as const };
    const [identity] = await db.insert(brandIdentities).values({ clientId }).returning();
    const document = emptyDocument();
    document.verbal.forbiddenWords = ["economico"];
    document.verbal.spellings = [{ term: "e-commerce" }];
    const at = new Date();
    await db.insert(brandIdentityVersions).values({
      brandIdentityId: identity!.id,
      clientId,
      number: 1,
      status: "published",
      document: document as unknown as Record<string, unknown>,
      tokens: defaultTokens(),
      approvedBy: anna.id,
      approvedAt: at,
      publishedBy: anna.id,
      publishedAt: at,
    });
  });

  afterAll(async () => {
    if (db && clientId) {
      for (const table of [
        "brand_check_issue_states",
        "brand_check_runs",
        "brand_identity_versions",
        "brand_identities",
        "audit_events",
      ])
        await db.execute(
          sql`delete from ${sql.identifier(table)} where client_id in (${clientId}, ${otherClientId})`,
        );
      await db.execute(sql`delete from clients where id in (${clientId}, ${otherClientId})`);
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("lets the Reviewer agent run checks against the published identity", async () => {
    const result = await runBrandCheck(db, reviewer, {
      clientId,
      subject,
      content: carousel("Ecommerce economico"),
    });
    expect(result.report.findings.map((f) => f.check).sort()).toEqual([
      "forbidden_word",
      "render_unverified",
      "spelling",
    ]);
    expect(result.report.brandIdentityVersionNumber).toBe(1);
    expect(result.subjectVersion).toBe(1);
    const events = await db.execute<{ actor: string }>(
      sql`select actor from audit_events where client_id = ${clientId} and action = 'brand_check_completed'`,
    );
    expect(events.rows).toEqual([{ actor: "agent:reviewer" }]);
    expect(
      await codeOf(
        runBrandCheck(db, anna, { clientId: otherClientId, subject, content: carousel("x") }),
      ),
    ).toBe("BRAND-NOT-PUBLISHED");
  });

  it("lets only people ignore warnings, with a reason", async () => {
    const check = (await getBrandCheck(db, anna, { clientId, subject }))!;
    const warning = check.report.findings.find((f) => f.check === "spelling")!;
    const error = check.report.findings.find((f) => f.check === "forbidden_word")!;
    const ignore = (
      actor: Actor,
      findingKey: string,
      reason: BrandCheckIgnoreReason = "client_request",
    ) => ignoreFinding(db, actor, { clientId, subject, findingKey, reason });

    expect(await codeOf(ignore(reviewer, warning.key))).toBe("permission_denied");
    expect(await codeOf(ignore(anna, error.key))).toBe("BRAND-CHECK-ERROR-NOT-IGNORABLE");
    expect(await codeOf(ignore(anna, warning.key, "other"))).toBe("BRAND-CHECK-NOTE-REQUIRED");
    expect(await codeOf(ignore(anna, "nope"))).toBe("BRAND-CHECK-FINDING-NOT-FOUND");
    expect(await codeOf(ignore(anna, warning.key))).toBe("ok");
    // Ignoring again replaces the decision.
    expect(await codeOf(ignore(anna, warning.key, "false_positive"))).toBe("ok");

    const after = (await getBrandCheck(db, anna, { clientId, subject }))!;
    expect(after.report.findings.find((f) => f.key === warning.key)).toMatchObject({
      status: "ignored",
      ignored: { by: anna.id, reason: "false_positive" },
    });
    expect(after.report.open).toEqual({ error: 1, warning: 1, note: 0 });

    await reopenFinding(db, anna, { clientId, subject, findingKey: warning.key });
    const reopened = (await getBrandCheck(db, anna, { clientId, subject }))!;
    expect(reopened.report.findings.find((f) => f.key === warning.key)?.status).toBe("open");
  });

  it("gates approval on a fresh check and “I’ve seen it” from a person", async () => {
    const confirm = (actor: Actor, version: number, keys: string[]) =>
      confirmBrandCheckForApproval(db, actor, {
        clientId,
        subject: { ...subject, version },
        acknowledgedKeys: keys,
      });
    const check = (await getBrandCheck(db, anna, { clientId, subject }))!;
    const keys = check.report.findings.map((f) => f.key);

    expect(await codeOf(confirm(reviewer, 1, keys))).toBe("permission_denied");
    expect(await codeOf(confirm(anna, 2, keys))).toBe("BRAND-CHECK-STALE");
    expect(await codeOf(confirm(anna, 1, []))).toBe("CHECKS-NOT-ACKNOWLEDGED");
    expect(await codeOf(confirm(anna, 1, keys))).toBe("ok");
    // Stored per version: approving the same version again needs no new ticks.
    expect(await codeOf(confirm(anna, 1, []))).toBe("ok");
    const stored = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from brand_check_issue_states where client_id = ${clientId} and status = 'acknowledged'`,
    );
    expect(stored.rows[0]!.n).toBe(keys.length);
  });

  it("does not return a check through another client", async () => {
    expect(await getBrandCheck(db, anna, { clientId: otherClientId, subject })).toBeNull();
  });
});
