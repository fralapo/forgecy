import type { SiteProbe } from "@forgecy/audit";
import type { AiGateway } from "@forgecy/ai";
import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  and,
  auditEvents,
  brandIdentityProposals,
  brandIdentityVersions,
  brandSources,
  clients,
  createDb,
  eq,
  grantClientAccess,
  sql,
  userActor,
  users,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyImport, latestAutoImport, undoImport } from "../src/auto-import";
import { publishChecks } from "../src/checks";
import { parseDocument } from "../src/document";
import type { AnalystItem } from "../src/import/analyst";
import { runSourceImport } from "../src/import/run";
import {
  addSource,
  approveAndPublish,
  ensureDraft,
  saveDraftSection,
  updateSourceStatus,
} from "../src/service";
import type { TokenTree } from "../src/tokens";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const PAGES = [
  {
    locator: "/",
    text: "DeoDue è bifase: una fase ammorbidisce, l’altra è solo profumo. Nata nel Sud Italia.",
  },
  { locator: "/about", text: "Siamo una famiglia che produce deodoranti dal 1998." },
];

const VISUAL: SiteProbe = {
  cssVars: [{ name: "--brand-primary", hex: "#1d3a8a" }],
  themeColor: "#f5ebdc",
  buttonColors: [],
  fonts: [{ family: "Playfair Display", roles: ["headings"], loaded: true }],
  logos: [],
  images: [],
};

const item = (over: Record<string, unknown>) =>
  ({
    locator: "/",
    quote: "una fase ammorbidisce, l'altra è solo profumo",
    rationale: "From the home page",
    confidence: 0.8,
    ...over,
  }) as AnalystItem;

const POSITIONING = item({ field: "positioning", text: "Il deodorante bifase del Sud Italia" });
const ONE_LINER = item({ field: "oneLiner", text: "Il deodorante bifase" });
const VALUE = item({
  field: "value",
  name: "Famiglia",
  locator: "/about",
  quote: "Siamo una famiglia che produce deodoranti dal 1998.",
});
const AUDIENCE = item({ field: "audience", name: "Famiglie del Sud" });

const fakeAi = (items: AnalystItem[]) =>
  ({
    generateObject: async () => ({
      data: { items },
      provider: "openrouter",
      model: "fake/model",
    }),
  }) as unknown as AiGateway;

type User = Extract<Actor, { type: "user" }>;

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

async function refOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PermissionDeniedError) return "permission_denied";
    if (err instanceof ForgecyError) return err.ref?.key ?? err.code;
    throw err;
  }
  return "ok";
}

describe.skipIf(!dbUrl)("automatic import (integration)", () => {
  let db: Database;
  const suffix = Math.random().toString(36).slice(2, 8);
  const clientIds: string[] = [];
  let anna: User;
  let outsider: User;
  let inactive: User;
  const agent: Actor = { type: "agent", role: "brand_analyst", runId: crypto.randomUUID() };
  const storage = {} as StorageDriver;

  const mkUser = async (name: string, values: { active?: boolean } = {}) => {
    const [u] = await db
      .insert(users)
      .values({ name, email: `${name}-${suffix}@example.test`, ...values })
      .returning();
    return u!.id;
  };

  const mkClient = async (name: string) => {
    const [c] = await db
      .insert(clients)
      .values({ name: `Auto ${name} ${suffix}`, slug: `brand-auto-${name}-${suffix}` })
      .returning();
    clientIds.push(c!.id);
    for (const u of [anna, inactive])
      await grantClientAccess(db, { userId: u.id, clientId: c!.id, createdBy: null });
    // The actor is read again: it carries the client scope.
    anna = (await userActor(db, anna.id))!;
    return c!.id;
  };

  /** One website import job, as the worker runs it. */
  const runImport = async (
    clientId: string,
    items: AnalystItem[],
    opts: {
      requestedBy?: string | null;
      visual?: SiteProbe;
      autoApply?: boolean;
      jobId?: string;
      title?: string;
    } = {},
  ) => {
    const s = await addSource(db, anna, {
      clientId,
      kind: "website",
      title: opts.title ?? "deodue.test",
    });
    await updateSourceStatus(db, s.id, {
      pages: PAGES,
      ...(opts.visual ? { visual: opts.visual as unknown as Record<string, unknown> } : {}),
    });
    const jobId = opts.jobId ?? crypto.randomUUID();
    const result = await runSourceImport(
      { db, storage, ai: fakeAi(items) },
      {
        jobId,
        attempt: 1,
        maxAttempts: 1,
        requestedBy: opts.requestedBy === undefined ? anna.id : opts.requestedBy,
      },
      { clientId, sourceId: s.id, autoApply: opts.autoApply ?? true },
    );
    const [source] = await db.select().from(brandSources).where(eq(brandSources.id, s.id));
    return { result, source: source!, jobId };
  };

  const proposalsOf = (runId: string) =>
    db.select().from(brandIdentityProposals).where(eq(brandIdentityProposals.runId, runId));
  const versionsOf = (clientId: string) =>
    db
      .select()
      .from(brandIdentityVersions)
      .where(eq(brandIdentityVersions.clientId, clientId))
      .orderBy(brandIdentityVersions.number);
  const eventsOf = (clientId: string, action: string) =>
    db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, action)));

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 6 });
    const scope = { isAdmin: false, active: true, clients: [] as string[] };
    anna = { type: "user", id: await mkUser("anna"), ...scope };
    outsider = { type: "user", id: await mkUser("otto"), ...scope };
    inactive = { type: "user", id: await mkUser("ines", { active: false }), ...scope };
  });

  afterAll(async () => {
    if (db)
      for (const clientId of clientIds) {
        for (const table of [
          "brand_identity_proposals",
          "brand_identity_versions",
          "brand_identities",
          "brand_sources",
          "audit_events",
          "notifications",
        ])
          await db.execute(sql`delete from ${sql.identifier(table)} where client_id = ${clientId}`);
        await db.delete(clients).where(eq(clients.id, clientId));
      }
    await db?.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    await db?.$client.end();
  });

  let main: string;
  let firstVersion: string;

  it("publishes a fresh client's import with the person who started it as approver", async () => {
    main = await mkClient("main");
    const { result, source, jobId } = await runImport(main, [POSITIONING], { visual: VISUAL });
    expect(result.auto).toMatchObject({ published: true, skippedHandEdited: 0 });
    expect(result.auto!.accepted).toBeGreaterThanOrEqual(4); // positioning, two colors, a font

    const mine = await proposalsOf(jobId);
    expect(mine.length).toBe(result.auto!.accepted);
    for (const p of mine)
      expect(p).toMatchObject({ status: "accepted", reviewedBy: anna.id, authorType: "agent" });

    const [v1] = await versionsOf(main);
    firstVersion = v1!.id;
    expect(v1).toMatchObject({
      id: result.auto!.versionId,
      number: 1,
      status: "published",
      approvedBy: anna.id,
      publishedBy: anna.id,
      approvalNote: "Automatic import",
      changelog: "Automatic import from deodue.test",
    });
    const doc = parseDocument(v1!.document);
    expect(doc.strategy.positioning?.value).toBe("Il deodorante bifase del Sud Italia");
    // The open checks were acknowledged, and exactly those.
    const open = publishChecks(doc, v1!.tokens as TokenTree, {}).map((c) => c.key);
    expect(v1!.acknowledgedChecks.length).toBeGreaterThan(0);
    expect([...v1!.acknowledgedChecks].sort()).toEqual([...open].sort());

    const autoAccepts = await eventsOf(main, "brand.proposal.auto_accept");
    expect(autoAccepts.length).toBe(result.auto!.accepted);
    expect(autoAccepts.every((e) => e.actorUserId === anna.id && e.meta.auto === true)).toBe(true);
    for (const action of ["brand.version.approve", "brand.version.publish"]) {
      const [e] = await eventsOf(main, action);
      expect(e).toMatchObject({ entityId: v1!.id, actorUserId: anna.id });
      expect(e!.meta).toMatchObject({ auto: true, runId: jobId });
    }
    expect(source.statusDetailRef?.map((r) => r.key)).toContain("brand.import.status.autoApplied");
    expect(source.statusDetail).toContain("applied automatically · version published");

    expect(await latestAutoImport(db, anna, main)).toMatchObject({
      versionId: v1!.id,
      number: 1,
      accepted: result.auto!.accepted,
      current: true,
    });
    expect(await refOf(latestAutoImport(db, outsider, main))).toBe("permission_denied");
  });

  it("keeps a one-liner a person wrote when the site is imported again", async () => {
    const draft = await ensureDraft(db, anna, main);
    const strategy = (draft.document as { strategy: Record<string, unknown> }).strategy;
    const saved = await saveDraftSection(db, anna, {
      clientId: main,
      versionId: draft.id,
      rev: draft.rev,
      section: "strategy",
      value: {
        ...strategy,
        oneLiner: { id: "o1", value: "Written by Anna", sourceIds: [], confidence: "high" },
      },
    });
    const publish = { clientId: main, versionId: draft.id, rev: saved.rev };
    const human = {
      ...publish,
      changelog: "One-liner written by the team",
      note: "Written in the kickoff",
    };
    const v2 = await approveAndPublish(db, anna, {
      ...human,
      acknowledged: await missingChecks(
        approveAndPublish(db, anna, { ...human, acknowledged: [] }),
      ),
    });

    const { result, jobId } = await runImport(main, [ONE_LINER, VALUE]);
    expect(result.auto).toMatchObject({ accepted: 1, skippedHandEdited: 1, published: true });
    const kept = (await proposalsOf(jobId)).find(
      (p) => p.fieldPath === "/document/strategy/oneLiner",
    )!;
    expect(kept).toMatchObject({
      status: "rejected",
      reviewedBy: anna.id,
      reviewNote: "hand-edited field kept",
    });

    const versions = await versionsOf(main);
    const v3 = versions.find((v) => v.id === result.auto!.versionId)!;
    expect(v3).toMatchObject({ number: 3, status: "published" });
    expect(versions.find((v) => v.id === v2.versionId)!.status).toBe("archived");
    const doc = parseDocument(v3.document);
    expect(doc.strategy.oneLiner?.value).toBe("Written by Anna");
    expect(doc.strategy.values.map((v) => v.value.name)).toContain("Famiglia");
  });

  it("leaves the proposals pending when nobody started the run", async () => {
    const clientId = await mkClient("system");
    const { result, source, jobId } = await runImport(clientId, [POSITIONING], {
      requestedBy: null,
    });
    expect(result.auto).toMatchObject({ accepted: 0, published: false, reason: "no_requester" });
    const mine = await proposalsOf(jobId);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((p) => p.status === "proposed")).toBe(true);
    expect((await versionsOf(clientId)).every((v) => v.status === "draft")).toBe(true);
    expect(source.statusDetailRef?.map((r) => r.key)).toContain(
      "brand.import.status.autoNotApplied",
    );
    expect(source.statusDetail).toContain("the import was not started by a person");
  });

  it("writes nothing for a person without access, or no longer active", async () => {
    for (const [who, reason] of [
      [outsider.id, "no_access"],
      [inactive.id, "no_permission"],
      [crypto.randomUUID(), "no_requester"],
    ] as const) {
      const clientId = await mkClient(`denied-${reason}`);
      const { result, jobId } = await runImport(clientId, [POSITIONING], { requestedBy: who });
      expect(result.auto).toMatchObject({ accepted: 0, published: false, reason });
      expect((await proposalsOf(jobId)).every((p) => p.status === "proposed")).toBe(true);
      expect((await versionsOf(clientId)).every((v) => v.status === "draft")).toBe(true);
      expect(await eventsOf(clientId, "brand.proposal.auto_accept")).toEqual([]);
    }
  });

  it("never acts for an agent: it takes no actor, and a non-user id is nobody", async () => {
    const clientId = await mkClient("agent");
    const { jobId } = await runImport(clientId, [POSITIONING], { autoApply: false });
    // @ts-expect-error applyImport takes no actor: it rebuilds the person from requestedBy.
    const asAgent = await applyImport(db, agent, { clientId, requestedBy: null, runId: jobId });
    expect(asAgent).toMatchObject({ accepted: 0, reason: "no_requester" });
    const byName = await applyImport(db, {
      clientId,
      requestedBy: "agent:brand_analyst",
      runId: jobId,
    });
    expect(byName).toMatchObject({ accepted: 0, reason: "no_requester" });
    expect((await proposalsOf(jobId)).every((p) => p.status === "proposed")).toBe(true);
  });

  it("does not auto-apply an uploaded document's proposals", async () => {
    const clientId = await mkClient("doc");
    const s = await addSource(db, anna, { clientId, kind: "document", title: "Brief" });
    await updateSourceStatus(db, s.id, { pages: PAGES });
    const jobId = crypto.randomUUID();
    const result = await runSourceImport(
      { db, storage, ai: fakeAi([POSITIONING]) },
      { jobId, attempt: 1, maxAttempts: 1, requestedBy: anna.id },
      { clientId, sourceId: s.id, autoApply: true },
    );
    expect(result.auto).toBeUndefined();
    // Even asked directly, a document's proposals stay in the queue.
    expect(await applyImport(db, { clientId, requestedBy: anna.id, runId: jobId })).toMatchObject({
      accepted: 0,
      published: false,
    });
    expect((await proposalsOf(jobId)).every((p) => p.status === "proposed")).toBe(true);
  });

  let concurrent: string;

  it("publishes once when the same run is applied twice at the same time", async () => {
    concurrent = await mkClient("race");
    const { jobId } = await runImport(concurrent, [POSITIONING, VALUE], { autoApply: false });
    const input = { clientId: concurrent, requestedBy: anna.id, runId: jobId };
    const [a, b] = await Promise.all([applyImport(db, input), applyImport(db, input)]);
    expect([a.published, b.published].filter(Boolean)).toHaveLength(1);
    expect(a.accepted + b.accepted).toBe(2);
    const published = (await versionsOf(concurrent)).filter((v) => v.publishedAt);
    expect(published).toHaveLength(1);
    expect((await proposalsOf(jobId)).every((p) => p.status === "accepted")).toBe(true);
  });

  it("serializes two different runs on one client without losing proposals", async () => {
    const one = await runImport(concurrent, [AUDIENCE], { autoApply: false, title: "one" });
    const two = await runImport(concurrent, [ONE_LINER], { autoApply: false, title: "two" });
    const results = await Promise.all(
      [one.jobId, two.jobId].map((runId) =>
        applyImport(db, { clientId: concurrent, requestedBy: anna.id, runId }),
      ),
    );
    expect(results.every((r) => r.published && r.accepted === 1)).toBe(true);
    const versions = await versionsOf(concurrent);
    expect(versions.filter((v) => v.status === "published")).toHaveLength(1);
    expect(versions.filter((v) => v.publishedAt)).toHaveLength(3);
    const doc = parseDocument(versions.find((v) => v.status === "published")!.document);
    expect(doc.strategy.oneLiner?.value).toBe("Il deodorante bifase");
    expect(doc.strategy.audience.map((a) => a.value.name)).toContain("Famiglie del Sud");
    for (const { jobId } of [one, two])
      expect((await proposalsOf(jobId)).every((p) => p.status === "accepted")).toBe(true);
  });

  it("keeps accepted items in the draft when the draft cannot be published", async () => {
    const clientId = await mkClient("invalid");
    const { jobId } = await runImport(clientId, [POSITIONING], { autoApply: false });
    // A broken alias in the draft: accepting a text field still works, publishing does not.
    const [draft] = await versionsOf(clientId);
    const tokens = structuredClone(draft!.tokens) as {
      color: { semantic: Record<string, unknown> };
    };
    tokens.color.semantic.accent = { $value: "{color.reference.missing}" };
    await db
      .update(brandIdentityVersions)
      .set({ tokens })
      .where(eq(brandIdentityVersions.id, draft!.id));

    const result = await applyImport(db, { clientId, requestedBy: anna.id, runId: jobId });
    expect(result).toMatchObject({ accepted: 1, published: false, reason: "not_publishable" });
    const [after] = await versionsOf(clientId);
    expect(after!.status).toBe("draft");
    expect(parseDocument(after!.document).strategy.positioning?.value).toBe(
      "Il deodorante bifase del Sud Italia",
    );
    expect((await proposalsOf(jobId)).every((p) => p.status === "accepted")).toBe(true);
    expect(await eventsOf(clientId, "brand.version.publish")).toEqual([]);
  });

  it("undoes an automatic import back to the version before it", async () => {
    const before = await latestAutoImport(db, anna, main);
    expect(before).toMatchObject({ number: 3, current: true });
    const v3 = before!.versionId;

    expect(await refOf(undoImport(db, agent, { clientId: main, versionId: v3 }))).toBe(
      "permission_denied",
    );
    expect(await refOf(undoImport(db, outsider, { clientId: main, versionId: v3 }))).toBe(
      "permission_denied",
    );
    expect(await refOf(undoImport(db, anna, { clientId: main, versionId: firstVersion }))).toBe(
      "brand.errors.undoNotCurrent",
    );

    const undone = await undoImport(db, anna, { clientId: main, versionId: v3 });
    expect(undone).toMatchObject({ number: 4, archivedVersionId: v3 });
    const versions = await versionsOf(main);
    const v4 = versions.find((v) => v.number === 4)!;
    const v2 = versions.find((v) => v.number === 2)!;
    expect(v4).toMatchObject({
      status: "published",
      publishedBy: anna.id,
      restoredFromVersionId: v2.id,
      changelog: "Undo of automatic import v3",
    });
    expect(v4.document).toEqual(v2.document);
    expect(await latestAutoImport(db, anna, main)).toMatchObject({ number: 3, current: false });

    // v4 was published by a person, not by an import.
    expect(await refOf(undoImport(db, anna, { clientId: main, versionId: v4.id }))).toBe(
      "brand.errors.undoNotAutomatic",
    );
  });

  it("refuses to undo a first import: there is nothing before it", async () => {
    const clientId = await mkClient("first");
    const { result } = await runImport(clientId, [POSITIONING]);
    expect(result.auto?.published).toBe(true);
    expect(
      await refOf(undoImport(db, anna, { clientId, versionId: result.auto!.versionId! })),
    ).toBe("brand.errors.undoNoPrevious");
  });
});
