import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAiGateway, createDbLedger, createFakeTextProvider } from "@forgecy/ai";
import { defaultTokens, parseDocument as parseBrandDocument } from "@forgecy/brand";
import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  brandIdentities,
  brandIdentityVersions,
  clientAccess,
  clients,
  contents,
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
import { runAdaptChannel, type PipelineDeps } from "../src/ai/pipeline";
import { acceptAdaptation, dismissAdaptation, latestAdaptations } from "../src/carousels/adapt";
import { createCarousel, getContentRow, saveDraft } from "../src/carousels/carousels";
import { parseDocument } from "../src/document";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const load = (dir: string) =>
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, `../../../templates/carousels/${dir}/template.json`),
      "utf8",
    ),
  );

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

describe.skipIf(!dbUrl)("channel adaptation (integration)", () => {
  let db: Database;
  let clientId: string;
  let anna: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const igKey = `adapt-ig-${suffix}`;
  const liKey = `adapt-li-${suffix}`;
  const fake = createFakeTextProvider("anthropic");
  let deps: PipelineDeps;
  let sourceId: string;
  let sourceRev: number;

  const job = async (kind: string) => {
    const [row] = await db
      .insert(jobs)
      .values({ kind, status: "running", clientId })
      .returning({ id: jobs.id });
    return { jobId: row!.id, requestedBy: anna.id, progress: async () => {} };
  };
  /** The worker's bookkeeping: the result of a finished job, attached to the content. */
  const finish = (jobId: string, result: object, entityId = sourceId) =>
    db
      .update(jobs)
      .set({ status: "completed", entity: "content", entityId, result: result as never })
      .where(eq(jobs.id, jobId));

  const reply = (creditableAngle: boolean) => ({
    json: {
      creditableAngle,
      angle: creditableAngle ? "The payoff becomes a procedure a team can adopt." : "",
      reason: creditableAngle ? "The proof is a process." : "A scroll-and-save habit.",
      slides: creditableAngle
        ? [
            {
              layout: "cover",
              slots: [{ name: "title", text: "T".repeat(400), items: [] }],
            },
            {
              layout: "text",
              slots: [
                { name: "title", text: "Step one", items: [] },
                { name: "body", text: "Write it down.", items: [] },
              ],
            },
          ]
        : [],
      caption: creditableAngle ? "Hook first. More text." : "",
      hashtags: creditableAngle ? ["safety", "work", "team"] : [],
    },
  });

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const [c] = await db
      .insert(clients)
      .values({ name: `Adapt ${suffix}`, slug: `adapt-test-${suffix}` })
      .returning();
    clientId = c!.id;
    const [u] = await db
      .insert(users)
      .values({ name: "anna", email: `anna-${suffix}@example.test` })
      .returning();
    await db.insert(clientAccess).values({ userId: u!.id, clientId });
    anna = { type: "user", id: u!.id, isAdmin: false, active: true, clients: [clientId] };
    const [bi] = await db.insert(brandIdentities).values({ clientId }).returning();
    const document = parseBrandDocument({
      strategy: {
        oneLiner: { id: "o1", value: "Safety that teams adopt" },
        audience: [{ id: "seg1", value: { name: "Managers", problems: "Incidents" } }],
      },
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
    for (const [key, dir, channel, format] of [
      [igKey, "editorial-ig-4x5", "instagram", "ig_4x5"],
      [liKey, "editorial-linkedin", "linkedin", "linkedin_doc"],
    ] as const) {
      const manifest = load(dir);
      await db.insert(templates).values({
        key,
        version: manifest.version,
        name: `A-adapt ${key}`,
        kind: "carousel",
        channel,
        format,
        status: "published",
        manifest: { ...manifest, id: key },
        packageKey: "system/templates/none.zip",
        packageSha256: "0".repeat(64),
        packageSize: 1,
        validation: { ok: true, rendered: true, checks: [], issues: [] },
      });
    }
    deps = {
      db,
      storage: new LocalDiskDriver({
        root: path.join(tmpdir(), `forgecy-adapt-${suffix}`),
        baseUrl: "http://localhost:3000",
        secret: "test-secret-test-secret",
      }),
      ai: createAiGateway({
        ledger: createDbLedger(db),
        providers: { text: { anthropic: fake }, image: {} },
        routing: { default: { primary: { provider: "anthropic", model: "fake-model" } } },
      }),
    };
    const src = await createCarousel(db, anna, {
      clientId,
      params: {
        title: "Cool water",
        objective: "education",
        audienceIds: ["seg1"],
        channel: "instagram",
        format: "ig_4x5",
        templateKey: igKey,
        slideCount: 3,
        language: "en",
      } as never,
      brief: { text: "Why teams should write their safety steps down." },
    });
    sourceId = src.id;
    const saved = await saveDraft(db, anna, {
      clientId,
      id: src.id,
      draftRev: src.draftRev,
      document: {
        title: "Cool water",
        slides: [
          { id: "a", layout: "cover", slots: { title: "Write it down" } },
          { id: "b", layout: "text", slots: { title: "Why", body: "Because memory fails." } },
        ],
        caption: "Save this.",
        hashtags: ["#a", "#b", "#c"],
      },
    });
    sourceRev = saved.draftRev;
  });

  afterAll(async () => {
    if (db && clientId) {
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.delete(templates).where(eq(templates.key, igKey));
      await db.delete(templates).where(eq(templates.key, liKey));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("only proposes for an Instagram carousel that is in review or approved", async () => {
    const run = await job("content.adapt_channel");
    await expect(
      runAdaptChannel(deps, run, { clientId, contentId: sourceId, channel: "linkedin" }),
    ).rejects.toMatchObject({ message: expect.stringContaining("in review or approved") });
  });

  it("proposes, then a person accepts it as a NEW draft; the source is untouched", async () => {
    await db.update(contents).set({ status: "approved" }).where(eq(contents.id, sourceId));
    fake.push(reply(true));
    const run = await job("content.adapt_channel");
    const out = await runAdaptChannel(deps, run, {
      clientId,
      contentId: sourceId,
      channel: "linkedin",
    });
    expect(out.proposal).toMatchObject({
      channel: "linkedin",
      creditableAngle: true,
      gateMetric: "dwell_comments",
      draftRev: sourceRev,
    });
    expect(out.proposal.slides.map((s) => s.layout)).toEqual(["cover", "text"]);
    const sent = JSON.stringify(fake.calls.at(-1));
    expect(sent).toContain("Target channel: linkedin");
    expect(sent).toContain("Write it down");
    await finish(run.jobId, out);

    const pending = await latestAdaptations(db, sourceId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ jobId: run.jobId, decision: null });

    const agent: Actor = { type: "agent", role: "copywriter" };
    expect(await codeOf(acceptAdaptation(db, agent, { clientId, jobId: run.jobId }))).toBe(
      "permission_denied",
    );
    // A person without access to the client cannot answer it either.
    const stranger: Actor = { ...anna, clients: [] };
    expect(await codeOf(acceptAdaptation(db, stranger, { clientId, jobId: run.jobId }))).toBe(
      "permission_denied",
    );

    const created = await acceptAdaptation(db, anna, { clientId, jobId: run.jobId });
    expect(created).toMatchObject({
      clientId,
      channel: "linkedin",
      format: "linkedin_doc",
      status: "draft",
      language: "en",
      audienceIds: ["seg1"],
    });
    expect(created.id).not.toBe(sourceId);
    const fresh = await getContentRow(db, clientId, created.id);
    const doc = parseDocument(fresh.draft);
    expect(doc.slides.map((s) => s.layout)).toEqual(["cover", "text"]);
    expect((doc.slides[0]!.slots.title as string).length).toBeLessThan(400);
    expect(doc.hashtags).toEqual(["#safety", "#work", "#team"]);
    expect(doc.caption).toBe("Hook first. More text.");

    const source = await getContentRow(db, clientId, sourceId);
    expect(source).toMatchObject({ status: "approved", draftRev: sourceRev });

    const [answered] = await latestAdaptations(db, sourceId);
    expect(answered!.decision).toMatchObject({ status: "accepted", contentId: created.id });
    expect(await codeOf(acceptAdaptation(db, anna, { clientId, jobId: run.jobId }))).toBe(
      "conflict",
    );
    expect(await codeOf(dismissAdaptation(db, anna, { clientId, jobId: run.jobId }))).toBe(
      "conflict",
    );
  });

  it("a skip proposal cannot be accepted, and a dismissal creates nothing", async () => {
    fake.push(reply(false));
    const run = await job("content.adapt_channel");
    const out = await runAdaptChannel(deps, run, {
      clientId,
      contentId: sourceId,
      channel: "linkedin",
    });
    expect(out.proposal).toMatchObject({ creditableAngle: false, slides: [] });
    await finish(run.jobId, out);
    const before = await db
      .select({ id: contents.id })
      .from(contents)
      .where(eq(contents.clientId, clientId));
    expect(await codeOf(acceptAdaptation(db, anna, { clientId, jobId: run.jobId }))).toBe(
      "validation",
    );
    await dismissAdaptation(db, anna, { clientId, jobId: run.jobId });
    const after = await db
      .select({ id: contents.id })
      .from(contents)
      .where(eq(contents.clientId, clientId));
    expect(after).toHaveLength(before.length);
    const [answered] = await latestAdaptations(db, sourceId);
    expect(answered!.decision).toMatchObject({ status: "dismissed", contentId: null });
  });
});
