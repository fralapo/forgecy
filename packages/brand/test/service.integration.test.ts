import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  brandIdentityVersions,
  clients,
  createDb,
  eq,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPublishedBrandIdentity, loadBrandContext } from "../src/read";
import {
  acceptProposal,
  addSource,
  approveAndPublish,
  ensureDraft,
  proposeChange,
  rejectProposals,
  removeSource,
  restoreAsDraft,
  saveDraftSection,
  submitForReview,
} from "../src/service";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const agent: Actor = { type: "agent", role: "brand_analyst", runId: crypto.randomUUID() };

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

async function missingChecks(p: Promise<unknown>): Promise<string[]> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ForgecyError && err.details?.code === "CHECKS-NOT-ACKNOWLEDGED")
      return err.details.missing as string[];
    throw err;
  }
  return [];
}

describe.skipIf(!dbUrl)("brand identity workflow (integration)", () => {
  let db: Database;
  let clientId: string;
  let anna: Extract<Actor, { type: "user" }>;
  let bruno: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const [c] = await db
      .insert(clients)
      .values({ name: `Test ${suffix}`, slug: `brand-test-${suffix}` })
      .returning();
    clientId = c!.id;
    const mk = async (name: string) => {
      const [u] = await db
        .insert(users)
        .values({ name, email: `${name}-${suffix}@example.test` })
        .returning();
      return { type: "user" as const, id: u!.id, isAdmin: false, active: true };
    };
    anna = await mk("anna");
    bruno = await mk("bruno");
  });

  afterAll(async () => {
    if (db && clientId) {
      // Test rows only. The immutability trigger guards UPDATE, not cleanup.
      for (const table of [
        "brand_identity_proposals",
        "brand_identity_versions",
        "brand_identities",
        "brand_sources",
        "audit_events",
      ])
        await db.execute(sql`delete from ${sql.identifier(table)} where client_id = ${clientId}`);
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("refuses agents everywhere except proposals", async () => {
    expect(await codeOf(ensureDraft(db, agent, clientId))).toBe("permission_denied");
    expect(
      await codeOf(acceptProposal(db, agent, { clientId, proposalId: crypto.randomUUID() })),
    ).toBe("permission_denied");
    expect(
      await codeOf(
        approveAndPublish(db, agent, {
          clientId,
          versionId: crypto.randomUUID(),
          rev: 0,
          changelog: "x".repeat(30),
          acknowledged: [],
        }),
      ),
    ).toBe("permission_denied");
    expect(await getPublishedBrandIdentity(db, agent, clientId)).toBeNull();
  });

  it("runs propose, accept, stale, publish and restore", async () => {
    const book = await addSource(db, anna, {
      clientId,
      kind: "brand_book",
      title: "Brand book 2025",
    });
    const site = await addSource(db, agent, { clientId, kind: "website", title: "Website" });

    const p1 = await proposeChange(db, agent, {
      clientId,
      path: "/document/strategy/oneLiner",
      value: "Good coffee for people who work",
      evidence: [{ sourceId: book.id, locator: "p. 3" }],
    });
    const p2 = await proposeChange(db, agent, {
      clientId,
      path: "/document/strategy/oneLiner",
      value: "The office coffee",
      evidence: [{ sourceId: site.id }],
    });
    expect(p1).toMatchObject({ confidence: "high", sensitive: true, authorType: "agent" });
    expect(p2.confidence).toBe("medium");

    // A sensitive field in conflict counts as low confidence: a note is required.
    expect(await codeOf(acceptProposal(db, anna, { clientId, proposalId: p1.id }))).toBe(
      "NOTE-REQUIRED",
    );
    const accepted = await acceptProposal(db, anna, {
      clientId,
      proposalId: p1.id,
      note: "From the official brand book",
    });
    expect(accepted).toMatchObject({ status: "accepted", staled: 1 });

    const p3 = await proposeChange(db, agent, {
      clientId,
      path: "/document/strategy/category",
      value: "Coffee roasting",
      evidence: [{ sourceId: site.id }],
    });
    expect(await removeSource(db, anna, { clientId, sourceId: site.id })).toEqual({ staled: 1 });
    expect((await rejectProposals(db, anna, { clientId, proposalIds: [p3.id] })).rejected).toBe(0);

    const draft = await ensureDraft(db, anna, clientId);
    expect(draft.number).toBe(1);
    const strategy = (draft.document as { strategy: Record<string, unknown> }).strategy;
    const saved = await saveDraftSection(db, anna, {
      clientId,
      versionId: draft.id,
      rev: draft.rev,
      section: "strategy",
      value: {
        ...strategy,
        insight: {
          id: "i1",
          value: "People who work drink bad coffee",
          sourceIds: [],
          confidence: "high",
        },
      },
    });
    expect(
      await codeOf(
        saveDraftSection(db, anna, {
          clientId,
          versionId: draft.id,
          rev: draft.rev,
          section: "strategy",
          value: strategy,
        }),
      ),
    ).toBe("CONFLICT-DRAFT-REV");

    await submitForReview(db, anna, { clientId, versionId: draft.id, rev: saved.rev });

    const base = {
      clientId,
      versionId: draft.id,
      rev: saved.rev,
      changelog: "First version from the brand book",
    };
    expect(await codeOf(approveAndPublish(db, anna, { ...base, acknowledged: [] }))).toBe(
      "SELF-APPROVAL-NOTE",
    );
    expect(
      await codeOf(approveAndPublish(db, bruno, { ...base, changelog: "short", acknowledged: [] })),
    ).toBe("CHANGELOG-REQUIRED");
    const missing = await missingChecks(
      approveAndPublish(db, bruno, { ...base, acknowledged: [] }),
    );
    expect(missing.length).toBeGreaterThan(0);
    const pub = await approveAndPublish(db, bruno, { ...base, acknowledged: missing });
    expect(pub).toMatchObject({ number: 1, archivedVersionId: null });

    const published = await getPublishedBrandIdentity(db, agent, clientId);
    expect(published?.document.strategy.oneLiner?.value).toBe("Good coffee for people who work");
    const ctx = await loadBrandContext(db, agent, clientId, {});
    expect(ctx?.stable).toContain("Good coffee for people who work");

    // Published content is immutable at the database level.
    await expect(
      db
        .update(brandIdentityVersions)
        .set({ changelog: "rewritten" })
        .where(eq(brandIdentityVersions.id, pub.versionId)),
    ).rejects.toThrow();

    const d2 = await ensureDraft(db, bruno, clientId);
    expect(d2.number).toBe(2);
    const base2 = {
      clientId,
      versionId: d2.id,
      rev: d2.rev,
      changelog: "Second version without changes",
      note: "Checked by me",
    };
    const m2 = await missingChecks(approveAndPublish(db, bruno, { ...base2, acknowledged: [] }));
    const pub2 = await approveAndPublish(db, bruno, { ...base2, acknowledged: m2 });
    expect(pub2.archivedVersionId).toBe(pub.versionId);

    const restored = await restoreAsDraft(db, anna, { clientId, versionId: pub.versionId });
    expect(restored).toMatchObject({
      number: 3,
      status: "draft",
      restoredFromVersionId: pub.versionId,
    });
    expect(await codeOf(restoreAsDraft(db, anna, { clientId, versionId: pub.versionId }))).toBe(
      "DRAFT-EXISTS",
    );
    expect((await getPublishedBrandIdentity(db, anna, clientId))?.number).toBe(2);
  });
});
