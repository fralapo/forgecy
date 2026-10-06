import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAiGateway, createDbLedger, createFakeTextProvider } from "@forgecy/ai";
import { defaultTokens, parseDocument as parseBrandDocument } from "@forgecy/brand";
import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  brandIdentities,
  brandIdentityVersions,
  clients,
  contentPlanItems,
  contentVersions,
  createDb,
  eq,
  jobs,
  sql,
  templates,
  users,
  type Database,
} from "@forgecy/db";
import { LocalDiskDriver } from "@forgecy/files";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBrandGuard } from "../src/carousels/brand-guard";
import {
  approveOutline,
  createCarousel,
  decideReview,
  getContentRow,
  prepareExport,
  recordExport,
  saveBrief,
  saveDraft,
  submitForReview,
} from "../src/carousels/carousels";
import {
  runGenerateOutline,
  runGenerateSlides,
  runProposePlan,
  runProposeStrategy,
  type PipelineDeps,
} from "../src/ai/pipeline";
import {
  listProductUsage,
  noProducts,
  setProductSource,
  type ProductSummary,
} from "../src/products";
import type { Provenance } from "../src/document";
import { getCarouselWorkspace, getStrategyOverview } from "../src/queries";
import { activatePlan, createPillar, decideStrategyProposal } from "../src/strategy";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

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

const manifest = JSON.parse(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../templates/carousels/editorial-ig-4x5/template.json",
    ),
    "utf8",
  ),
);

describe.skipIf(!dbUrl)("content strategy and carousel flow (integration)", () => {
  let db: Database;
  let clientId: string;
  let anna: Extract<Actor, { type: "user" }>;
  let bruno: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const templateKey = `test-content-${suffix}`;
  const fake = createFakeTextProvider("anthropic");
  let deps: PipelineDeps;
  const product: ProductSummary = {
    id: crypto.randomUUID(),
    name: "Insulated water bottle",
    sku: "B-1",
    category: "Accessories",
    price: "€24.90",
    description: "Keeps water cool for 24 hours.",
    highlights: ["Stainless steel", "750 ml"],
    revision: 2,
    images: [],
  };

  const job = async (kind: string) => {
    const [row] = await db
      .insert(jobs)
      .values({ kind, status: "running", clientId })
      .returning({ id: jobs.id });
    return { jobId: row!.id, requestedBy: anna.id, progress: async () => {} };
  };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const [c] = await db
      .insert(clients)
      .values({ name: `Content ${suffix}`, slug: `content-test-${suffix}` })
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
    const [bi] = await db.insert(brandIdentities).values({ clientId }).returning();
    const document = parseBrandDocument({
      strategy: {
        oneLiner: { id: "o1", value: "Water bottles that last" },
        audience: [{ id: "seg1", value: { name: "Hikers", problems: "Warm water" } }],
      },
      verbal: { forbiddenWords: ["free"] },
    });
    await db.insert(brandIdentityVersions).values({
      brandIdentityId: bi!.id,
      clientId,
      number: 1,
      status: "published",
      document: document as unknown as Record<string, unknown>,
      tokens: defaultTokens(),
      approvedBy: anna.id,
      approvedAt: new Date(),
      publishedBy: anna.id,
      publishedAt: new Date(),
    });
    await db.insert(templates).values({
      key: templateKey,
      version: manifest.version,
      name: "Editorial test",
      kind: "carousel",
      channel: "instagram",
      format: "ig_4x5",
      status: "published",
      manifest: { ...manifest, id: templateKey },
      packageKey: "system/templates/none.zip",
      packageSha256: "0".repeat(64),
      packageSize: 1,
      validation: { ok: true, rendered: true, checks: [], issues: [] },
    });
    setProductSource({
      async listApproved() {
        return [product];
      },
      async get(_db, _client, id) {
        return id === product.id ? product : null;
      },
    });
    deps = {
      db,
      storage: new LocalDiskDriver({
        root: path.join(tmpdir(), `forgecy-content-${suffix}`),
        baseUrl: "http://localhost:3000",
        secret: "test-secret-test-secret",
      }),
      ai: createAiGateway({
        ledger: createDbLedger(db),
        providers: { text: { anthropic: fake }, image: {} },
        routing: { default: { primary: { provider: "anthropic", model: "fake-model" } } },
      }),
    };
  });

  afterAll(async () => {
    setProductSource(noProducts);
    setBrandGuard(null);
    if (db && clientId) {
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.delete(templates).where(eq(templates.key, templateKey));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("lets agents propose and people decide the strategy", async () => {
    const agent: Actor = { type: "agent", role: "strategist" };
    expect(await codeOf(createPillar(db, agent, clientId, { name: "X" }))).toBe(
      "permission_denied",
    );

    const manual = await createPillar(db, anna, clientId, {
      name: "Product",
      goal: "Make the bottle known",
      productIds: [product.id, crypto.randomUUID()],
    });
    // Ids not approved in the catalog are dropped.
    expect(manual.productIds).toEqual([product.id]);

    fake.push({
      json: {
        pillars: [
          {
            updates: "",
            name: "Mountain tips",
            goal: "Educate on hydration",
            audienceIds: ["seg1", "ghost"],
            funnel: "awareness",
            themes: ["Hydration"],
            frequency: { count: 2, unit: "week" },
            cta: "Save the post",
            emotion: "safety",
            examples: [],
            forbidden: [],
            productIds: [],
            rationale: "From the Hikers audience",
          },
        ],
        rubrics: [
          {
            pillarIndex: 0,
            pillarId: "",
            name: "Common mistake",
            frequency: { count: 1, unit: "week" },
            structure: [{ name: "Hook", role: "cover" }],
            hookFormula: "The mistake you make when…",
            hookExample: "The mistake you make uphill",
            cta: "Save",
            channels: ["instagram"],
          },
        ],
        rationale: "First strategy",
      },
    });
    const res = await runProposeStrategy(deps, await job("content.propose_strategy"), {
      clientId,
      instruction: "",
      language: "it",
    });
    expect(res).toMatchObject({ pillars: 1, rubrics: 1 });
    // The Planner writes in the language of the person who asked.
    expect(JSON.stringify(fake.calls.at(-1))).toContain("Language: it");

    const overview = await getStrategyOverview(db, anna, clientId);
    const proposed = overview.pillars.find((p) => p.status === "proposed")!;
    expect(proposed.audienceIds).toEqual(["seg1"]);
    expect(proposed.provenance).toMatchObject({ agent: "planner", model: "fake-model" });
    // Sources carry a reference, so they are shown in the reader's language.
    expect((proposed.provenance as Provenance | null)?.sources[0]).toMatchObject({
      kind: "brand",
      ref: { key: "content.labels.source.brand" },
    });
    const rubric = overview.rubrics.find((r) => r.status === "proposed")!;

    // Agents can never accept, and a rubric waits for its pillar.
    expect(
      await codeOf(
        decideStrategyProposal(db, agent, {
          clientId,
          kind: "pillar",
          id: proposed.id,
          decision: "accept",
        }),
      ),
    ).toBe("permission_denied");
    expect(
      await codeOf(
        decideStrategyProposal(db, anna, {
          clientId,
          kind: "rubric",
          id: rubric.id,
          decision: "accept",
        }),
      ),
    ).toBe("conflict");
    await decideStrategyProposal(db, anna, {
      clientId,
      kind: "pillar",
      id: proposed.id,
      decision: "accept",
    });
    await decideStrategyProposal(db, anna, {
      clientId,
      kind: "rubric",
      id: rubric.id,
      decision: "accept",
    });
    const after = await getStrategyOverview(db, anna, clientId);
    expect(after.pillars.filter((p) => p.status === "accepted")).toHaveLength(2);
  });

  it("proposes a plan that a person activates", async () => {
    const overview = await getStrategyOverview(db, anna, clientId);
    const pillar = overview.pillars.find((p) => p.name === "Product")!;
    fake.push({
      json: {
        items: [
          {
            day: 1,
            channel: "instagram",
            pillarId: pillar.id,
            rubricId: "",
            theme: "Why the water stays cool",
            hook: "24 hours of cool water",
            notes: "",
            productIds: [product.id],
          },
          {
            day: 2,
            channel: "linkedin",
            pillarId: pillar.id,
            rubricId: "",
            theme: "Channel not asked for",
            hook: "",
            notes: "",
            productIds: [],
          },
          {
            day: 3,
            channel: "instagram",
            pillarId: crypto.randomUUID(),
            rubricId: "",
            theme: "Made-up pillar",
            hook: "",
            notes: "",
            productIds: [],
          },
        ],
        rationale: "Trial plan",
      },
    });
    const res = await runProposePlan(deps, await job("content.propose_plan"), {
      clientId,
      instruction: "",
      channels: ["instagram"],
    });
    await activatePlan(db, anna, { clientId, planId: res.planId });
    const active = (await getStrategyOverview(db, anna, clientId)).activePlan!;
    expect(active.items).toHaveLength(1);
    expect(active.items[0]).toMatchObject({ status: "accepted", format: "ig_4x5" });
  });

  it("creates, writes, reviews and exports a carousel", async () => {
    const plan = (await getStrategyOverview(db, anna, clientId)).activePlan!;
    const item = plan.items[0]!;
    const c = await createCarousel(db, anna, {
      clientId,
      params: {
        objective: "education",
        audienceIds: ["seg1"],
        channel: "instagram",
        format: "ig_4x5",
        templateKey,
        slideCount: 7,
        planItemId: item.id,
        productId: product.id,
      },
    });
    expect(c).toMatchObject({ title: item.theme, pillarId: item.pillarId, productRevision: 2 });
    const [linked] = await db
      .select()
      .from(contentPlanItems)
      .where(eq(contentPlanItems.id, item.id));
    expect(linked!.contentId).toBe(c.id);

    const usage = await listProductUsage(db, clientId, product.id);
    expect(usage.contents.map((x) => x.id)).toEqual([c.id]);
    expect(usage.pillars.map((p) => p.name)).toEqual(["Product"]);
    expect(usage.planItems).toHaveLength(1);

    await saveBrief(db, anna, {
      clientId,
      id: c.id,
      briefRev: c.briefRev,
      brief: { text: "Explain why the bottle keeps water cool on a hike." },
    });

    const roles = ["cover", "text", "text", "list", "text", "text", "cta"] as const;
    fake.push({
      json: {
        title: "Cool water for 24 hours",
        hook: "Is your water warm after an hour?",
        rows: roles.map((role, i) => ({ role, layout: role, point: `Point ${i + 1}`, note: "" })),
        cta: "Discover the bottle",
      },
    });
    const outline = await runGenerateOutline(deps, await job("content.generate_outline"), {
      clientId,
      contentId: c.id,
      instruction: "",
      keepEdited: true,
    });
    expect(outline.rows).toBe(7);

    // Slides need an approved outline.
    expect(
      await runGenerateSlides(deps, await job("content.generate_slides"), {
        clientId,
        contentId: c.id,
      }).then(
        () => "ok",
        (e: Error) => e.name,
      ),
    ).toBe("NeedsAttentionError");
    await approveOutline(db, anna, { clientId, id: c.id, outlineNumber: outline.outlineNumber });

    const slot = (name: string, text: string) => ({ name, text, items: [] });
    fake.push({
      json: {
        slides: roles.map((role, i) => ({
          rowId: `r${i}`,
          layout: role,
          slots:
            role === "cover"
              ? [slot("title", "Cool water for 24 hours")]
              : role === "list"
                ? [
                    slot("title", "Three reasons"),
                    { name: "items", text: "", items: ["Steel", "Double wall"] },
                  ]
                : role === "cta"
                  ? [slot("title", "Try it uphill"), slot("action", "Learn more")]
                  : [
                      slot("title", `Point ${i + 1}`),
                      slot("body", "The double layer insulates the liquid."),
                    ],
          imageBriefs: [],
        })),
        caption: "Your water stays cool.",
        hashtags: ["hiking", "#waterbottle"],
      },
    });
    const slides = await runGenerateSlides(deps, await job("content.generate_slides"), {
      clientId,
      contentId: c.id,
    });
    expect(slides.slides).toBe(7);

    let ws = await getCarouselWorkspace(db, anna, clientId, c.id);
    expect(ws.document.slides).toHaveLength(7);
    expect(ws.document.hashtags).toEqual(["#hiking", "#waterbottle"]);
    expect(ws.checks?.errors).toEqual([]);
    expect(ws.content.templateVersion).toBe(manifest.version);

    // Stale autosave.
    expect(
      await codeOf(
        saveDraft(db, anna, {
          clientId,
          id: c.id,
          draftRev: ws.content.draftRev - 1,
          document: ws.document,
        }),
      ),
    ).toBe("CONFLICT-DRAFT-REV");

    // Brand Guard registered: it checks the submitted version and gates approval.
    const runs: Array<{ version: number | null | undefined; slides: number }> = [];
    const finding = {
      key: "hook_length:0:title",
      check: "hook_length",
      category: "editorial",
      severity: "warning" as const,
      slide: 0,
      slot: "title",
      message: "Long title",
      status: "open" as const,
    };
    const report = {
      checkedAt: new Date().toISOString(),
      findings: [finding],
      coherence: { band: "buono" as const },
      notRun: [],
    };
    setBrandGuard({
      run: async (_db, _actor, input) => {
        runs.push({ version: input.subject.version, slides: input.content.slides.length });
        return { report };
      },
      get: async () =>
        runs.length ? { subjectVersion: runs.at(-1)!.version ?? null, report } : null,
      confirmForApproval: async (_tx, _actor, input) => {
        if (!input.acknowledgedKeys.includes(finding.key))
          throw new ForgecyError("validation", "Seen", { code: "CHECKS-NOT-ACKNOWLEDGED" });
        return { ok: true };
      },
    });

    const { version } = await submitForReview(db, anna, {
      clientId,
      id: c.id,
      draftRev: ws.content.draftRev,
    });
    const agent: Actor = { type: "agent", role: "reviewer" };
    expect(
      await codeOf(
        decideReview(db, agent, {
          clientId,
          id: c.id,
          versionId: version.id,
          decision: "approved",
        }),
      ),
    ).toBe("permission_denied");
    // Self-approval needs a note.
    expect(
      await codeOf(
        decideReview(db, anna, { clientId, id: c.id, versionId: version.id, decision: "approved" }),
      ),
    ).toBe("SELF-APPROVAL-NOTE");
    // Final export only after approval.
    expect(await codeOf(prepareExport(db, anna, { clientId, id: c.id, draft: false }))).toBe(
      "EXPORT-NOT-APPROVED",
    );
    expect(runs.at(-1)).toEqual({ version: version.number, slides: 7 });
    expect(
      await codeOf(
        decideReview(db, bruno, {
          clientId,
          id: c.id,
          versionId: version.id,
          decision: "approved",
        }),
      ),
    ).toBe("CHECKS-NOT-ACKNOWLEDGED");
    await decideReview(db, bruno, {
      clientId,
      id: c.id,
      versionId: version.id,
      decision: "approved",
      acknowledged: [finding.key],
    });
    setBrandGuard(null);

    const prepared = await prepareExport(db, anna, { clientId, id: c.id, draft: false });
    expect(prepared.version.id).toBe(version.id);
    const exportJob = await job("content.export");
    await recordExport(db, {
      contentId: c.id,
      versionId: version.id,
      jobId: exportJob.jobId,
      draft: false,
      outputs: ["zip"],
      files: [{ name: "x.zip" }],
      requestedBy: anna.id,
    });
    const final = await getContentRow(db, clientId, c.id);
    expect(final.status).toBe("exported");

    ws = await getCarouselWorkspace(db, anna, clientId, c.id);
    expect(ws.versions.map((v) => v.createdFrom)).toEqual(["submit", "ai"]);
    expect(ws.approvals[0]).toMatchObject({ decision: "approved", selfApproval: false });
    // Versions are immutable snapshots.
    await expect(
      db
        .update(contentVersions)
        .set({ caption: "changed" })
        .where(eq(contentVersions.id, version.id)),
    ).rejects.toThrow();
  });
});
