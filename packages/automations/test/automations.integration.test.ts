import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAiGateway, createDbLedger, createFakeTextProvider } from "@forgecy/ai";
import { defaultTokens, parseDocument as parseBrandDocument } from "@forgecy/brand";
import type { PipelineDeps } from "@forgecy/content";
import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  automationRuns,
  automations,
  brandIdentities,
  brandIdentityVersions,
  clients,
  contents,
  createDb,
  claimNotificationEmails,
  eq,
  listNotifications,
  releaseNotificationEmails,
  sql,
  templates,
  users,
  type Database,
} from "@forgecy/db";
import { LocalDiskDriver } from "@forgecy/files";
import type { JobQueues } from "@forgecy/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAutomationItem } from "../src/handlers";
import {
  cancelRun,
  createAutomation,
  deleteAutomation,
  duplicateAutomation,
  getAutomation,
  listRunItems,
  pauseAutomation,
  resumeAutomation,
  retryFailedItems,
  startAutomation,
  updateAutomation,
} from "../src/service";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PermissionDeniedError) return "permission_denied";
    if (err instanceof ForgecyError) return err.code;
    throw err;
  }
  return "ok";
}

/** Records what would reach Redis; the jobs table rows are real. */
const queues = {
  get: () => ({
    add: async (_name: string, _data: unknown, opts: { jobId: string }) => ({ id: opts.jobId }),
  }),
  close: async () => {},
} as unknown as JobQueues;

const manifest = JSON.parse(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../templates/carousels/editorial-ig-4x5/template.json",
    ),
    "utf8",
  ),
);

const roles = ["cover", "text", "text", "list", "text", "text", "cta"] as const;
const outlineJson = {
  json: {
    title: "Cool water for 24 hours",
    hook: "Is your water warm after an hour?",
    rows: roles.map((role, i) => ({ role, layout: role, point: `Point ${i + 1}`, note: "" })),
    cta: "Discover the bottle",
  },
};

describe.skipIf(!dbUrl)("batch automations (integration)", () => {
  let db: Database;
  let clientId: string;
  let anna: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const templateKey = `test-automation-${suffix}`;
  const agent: Actor = { type: "agent", role: "copywriter" };
  const fake = createFakeTextProvider("anthropic");
  let pipeline: PipelineDeps;
  let automationId: string;

  const deps = () => ({ db, queues, localModel: false });
  const item = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: `Carousel ${id}`,
    brief: "Explain why the bottle keeps water cool on a hike.",
    objective: "education",
    ...over,
  });
  /** Runs the item a job was queued for, as the worker would. */
  const runQueued = async (runId: string) => {
    const queued = (await listRunItems(db, anna, runId)).find(
      (i) => i.status === "queued" && i.jobId,
    );
    expect(queued).toBeTruthy();
    return runAutomationItem(
      { db, queues, pipeline },
      { runItemId: queued!.id },
      { jobId: queued!.jobId!, progress: async () => {} },
    );
  };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const [c] = await db
      .insert(clients)
      .values({ name: `Automation ${suffix}`, slug: `automation-test-${suffix}`, status: "active" })
      .returning();
    clientId = c!.id;
    const [u] = await db
      .insert(users)
      .values({ name: "anna", email: `anna-${suffix}@example.test` })
      .returning();
    anna = { type: "user", id: u!.id, isAdmin: false, active: true };
    const [bi] = await db.insert(brandIdentities).values({ clientId }).returning();
    const document = parseBrandDocument({
      strategy: {
        oneLiner: { id: "o1", value: "Water bottles that last" },
        audience: [{ id: "seg1", value: { name: "Hikers", problems: "Warm water" } }],
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
    await db.insert(templates).values({
      key: templateKey,
      version: manifest.version,
      name: "Editorial test",
      kind: "carousel",
      channel: "instagram",
      format: "ig_4x5",
      status: "published",
      clientId,
      manifest: { ...manifest, id: templateKey },
      packageKey: "system/templates/none.zip",
      packageSha256: "0".repeat(64),
      packageSize: 1,
      validation: { ok: true, rendered: true, checks: [], issues: [] },
    });
    pipeline = {
      db,
      storage: new LocalDiskDriver({
        root: path.join(tmpdir(), `forgecy-automation-${suffix}`),
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
    if (db && clientId) {
      await db.delete(automations).where(eq(automations.clientId, clientId));
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.delete(templates).where(eq(templates.key, templateKey));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("is configured by people only, with a revision check", async () => {
    const input = { clientId, name: "October", source: "briefs" as const };
    expect(await codeOf(createAutomation(db, agent, input))).toBe("permission_denied");
    const created = await createAutomation(db, anna, {
      ...input,
      params: { templateKey, slideCount: 7 },
    });
    automationId = created.id;
    expect(created).toMatchObject({ status: "draft", stopAt: "outline", draftRev: 0 });

    const saved = await updateAutomation(db, anna, {
      id: automationId,
      rev: 0,
      items: [item("a"), item("b"), item("c", { objective: null })],
    });
    expect(saved.draftRev).toBe(1);
    expect(
      await codeOf(updateAutomation(db, anna, { id: automationId, rev: 0, name: "Stale" })),
    ).toBe("conflict");
    expect(await codeOf(startAutomation(deps(), anna, { id: automationId }))).toBe("validation");
    expect(await codeOf(startAutomation(deps(), agent, { id: automationId }))).toBe(
      "permission_denied",
    );
    await updateAutomation(db, anna, {
      id: automationId,
      rev: 1,
      items: [item("a"), item("b")],
    });
  });

  it("runs the items one at a time and keeps going after a failure", async () => {
    const run = await startAutomation(deps(), anna, { id: automationId });
    expect(run).toMatchObject({ number: 1, status: "running", stopAt: "outline" });
    expect((await getAutomation(db, anna, automationId)).status).toBe("active");
    // Read-only while it runs.
    expect(await codeOf(updateAutomation(db, anna, { id: automationId, rev: 2 }))).toBe("conflict");
    let items = await listRunItems(db, anna, run.id);
    expect(items.map((i) => [i.status, !!i.jobId])).toEqual([
      ["queued", true],
      ["queued", false],
    ]);

    fake.push(outlineJson);
    expect(await runQueued(run.id)).toMatchObject({ status: "completed" });
    fake.push({ error: "bad_request" });
    expect(await runQueued(run.id)).toMatchObject({ status: "failed" });

    items = await listRunItems(db, anna, run.id);
    expect(items.map((i) => [i.status, i.step])).toEqual([
      ["completed", "outline"],
      ["failed", "created"],
    ]);
    const [carousel] = await db
      .select()
      .from(contents)
      .where(eq(contents.id, items[0]!.contentId!));
    expect(carousel).toMatchObject({ status: "draft", templateKey, format: "ig_4x5" });
    const [ended] = await db.select().from(automationRuns).where(eq(automationRuns.id, run.id));
    expect(ended).toMatchObject({ status: "partial" });
    expect((await getAutomation(db, anna, automationId)).status).toBe("draft");
    // Anna, who started it, hears once how it ended.
    const bell = (await listNotifications(db, anna.id)).filter(
      (n) => n.kind === "automation_run_finished",
    );
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({
      params: { completed: 1, failed: 1, total: 2 },
      href: `/automations/${automationId}?tab=runs&run=${run.id}`,
    });
    // Email copy only after opting in; one worker claims it, a failed send puts it back.
    expect((await claimNotificationEmails(db)).some((r) => r.userId === anna.id)).toBe(false);
    await db.update(users).set({ emailNotifications: true }).where(eq(users.id, anna.id));
    const claimed = (await claimNotificationEmails(db)).filter((r) => r.userId === anna.id);
    expect(claimed.map((r) => r.id)).toEqual([bell[0]!.id]);
    expect(claimed[0]).toMatchObject({ kind: "automation_run_finished", locale: null });
    expect((await claimNotificationEmails(db)).some((r) => r.userId === anna.id)).toBe(false);
    await releaseNotificationEmails(db, [bell[0]!.id]);
    expect((await claimNotificationEmails(db)).map((r) => r.id)).toContain(bell[0]!.id);
    await db.update(users).set({ emailNotifications: false }).where(eq(users.id, anna.id));
  });

  it("retries the failed items, pauses, resumes and cancels", async () => {
    const retry = await retryFailedItems(deps(), anna, { id: automationId });
    expect(retry.number).toBe(2);
    await pauseAutomation(db, anna, { id: automationId });
    expect((await getAutomation(db, anna, automationId)).status).toBe("paused");
    // The worker takes the job after the pause: the item waits.
    const [waiting] = await listRunItems(db, anna, retry.id);
    expect(
      await runAutomationItem(
        { db, queues, pipeline },
        { runItemId: waiting!.id },
        { jobId: waiting!.jobId!, progress: async () => {} },
      ),
    ).toMatchObject({ status: "waiting" });

    await resumeAutomation(deps(), anna, { id: automationId });
    const [requeued] = await listRunItems(db, anna, retry.id);
    expect(requeued).toMatchObject({ status: "queued" });
    expect(requeued!.jobId).toBeTruthy();

    await cancelRun(db, anna, { id: automationId });
    const [cancelled] = await listRunItems(db, anna, retry.id);
    expect(cancelled!.status).toBe("cancelled");
    const [ended] = await db.select().from(automationRuns).where(eq(automationRuns.id, retry.id));
    expect(ended!.status).toBe("cancelled");
    expect((await getAutomation(db, anna, automationId)).status).toBe("draft");
  });

  it("deletes only drafts that never ran; a duplicate starts clean", async () => {
    expect(await codeOf(deleteAutomation(db, anna, automationId))).toBe("conflict");
    const copy = await duplicateAutomation(db, anna, { id: automationId, name: "Copy" });
    expect(copy).toMatchObject({ status: "draft", name: "Copy" });
    await deleteAutomation(db, anna, copy.id);
  });
});
