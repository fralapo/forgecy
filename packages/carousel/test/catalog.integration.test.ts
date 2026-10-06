import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Actor } from "@forgecy/core";
import { createDb, eq, inArray, jobs, templates, users, type Database } from "@forgecy/db";
import { LocalDiskDriver } from "@forgecy/files";
import {
  createJobWorker,
  createQueues,
  enqueueJob,
  subscribeJobEvents,
  type JobQueues,
  type JobWorker,
} from "@forgecy/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dbTemplateSource,
  importTemplate,
  isPublishable,
  saveTemplateValidation,
  transitionTemplate,
} from "../src/catalog";
import { carouselHandlers, sharedRenderBrowser } from "../src/export";
import { carouselExportJob, type ExportedFile, templateValidateJob } from "../src/jobs";
import { readTemplateDir } from "../src/node";
import { sampleSlide } from "../src/slide-schema";
import { TEMPLATES } from "./helpers";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const redisUrl = process.env.FORGECY_TEST_REDIS_URL;
const renders = Boolean(
  process.env.CI || process.env.FORGECY_CHROMIUM_PATH || process.env.FORGECY_RENDER_TESTS,
);
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const enc = new TextEncoder();
const dec = new TextDecoder();

/** The repository template under a unique key, so the test never touches real catalog rows. */
async function testPackage(key: string, version = "1.0.0") {
  const files = await readTemplateDir(path.join(TEMPLATES, "carousels", "editorial-ig-4x5"));
  const manifest = JSON.parse(dec.decode(files.get("template.json")!));
  files.set("template.json", enc.encode(JSON.stringify({ ...manifest, id: key, version })));
  return files;
}

describe.skipIf(!dbUrl)("template catalog (integration)", () => {
  let db: Database;
  let storage: LocalDiskDriver;
  let root: string;
  const key = `test-catalog-${Date.now().toString(36)}`;
  let actor: Actor;
  const agent: Actor = { type: "agent", role: "art_director" };

  beforeAll(async () => {
    db = createDb(dbUrl!);
    root = await mkdtemp(path.join(tmpdir(), "forgecy-catalog-"));
    storage = new LocalDiskDriver({
      root,
      baseUrl: "http://localhost:3000",
      secret: "test-secret-test-secret",
    });
    const [user] = await db
      .insert(users)
      .values({ name: "Catalog test", email: `${key}@example.test` })
      .returning();
    actor = { type: "user", id: user!.id, isAdmin: false, active: true };
  });

  afterAll(async () => {
    await db?.delete(templates).where(eq(templates.key, key));
    await db?.delete(users).where(eq(users.email, `${key}@example.test`));
    await db?.$client.end();
    await rm(root, { recursive: true, force: true });
  });

  it("imports a draft, refuses agents and keeps published versions immutable", async () => {
    const files = await testPackage(key);
    await expect(importTemplate({ db, storage, actor: agent, files })).rejects.toThrow(
      /Permission denied/,
    );

    const first = await importTemplate({ db, storage, actor, files });
    expect(first.row.status).toBe("draft");
    expect(first.row.key).toBe(key);
    expect(isPublishable(first.row)).toBe(false);

    // Same version again: the draft package is replaced, same row.
    const again = await importTemplate({ db, storage, actor, files });
    expect(again.replaced).toBe(true);
    expect(again.row.id).toBe(first.row.id);
    expect(again.row.packageSha256).toBe(first.row.packageSha256);

    // Publishing needs the worker's render checks.
    await expect(
      transitionTemplate({ db, actor, id: first.row.id, to: "published", notes: "First version" }),
    ).rejects.toThrow(/validation/);
    await saveTemplateValidation(db, first.row.id, { ok: true, checks: [], issues: [] });
    await expect(
      transitionTemplate({ db, actor, id: first.row.id, to: "published" }),
    ).rejects.toThrow(/what changes/);
    await expect(
      transitionTemplate({ db, actor: agent, id: first.row.id, to: "published", notes: "x x x" }),
    ).rejects.toThrow(/Permission denied/);
    const published = await transitionTemplate({
      db,
      actor,
      id: first.row.id,
      to: "published",
      notes: "First version",
    });
    expect(published.status).toBe("published");

    await expect(importTemplate({ db, storage, actor, files })).rejects.toThrow(/bump "version"/);

    const pkg = await dbTemplateSource({ db, storage }).get(key);
    expect(pkg?.manifest.id).toBe(key);
    expect(pkg?.manifest.layouts).toHaveLength(8);
    expect(await dbTemplateSource({ db, storage }).get(key, "9.9.9")).toBeUndefined();
  });

  describe.skipIf(!redisUrl || !renders)("worker jobs", () => {
    let queues: JobQueues;
    let worker: JobWorker;
    const browser = sharedRenderBrowser();
    const jobIds: string[] = [];

    beforeAll(async () => {
      queues = await createQueues(redisUrl!);
      worker = await createJobWorker({
        db,
        redisUrl: redisUrl!,
        handlers: carouselHandlers({ storage, browser: () => browser.get() }),
        logger: silent,
      });
    }, 60_000);

    afterAll(async () => {
      await worker?.close();
      await queues?.close();
      await browser.close();
      if (jobIds.length) await db.delete(jobs).where(inArray(jobs.id, jobIds));
    });

    async function run(job: Parameters<typeof enqueueJob>[2]) {
      const row = await enqueueJob(db, queues, job);
      jobIds.push(row.id);
      for await (const _ of subscribeJobEvents(db, row.id, { intervalMs: 200 })) void _;
      return (await db.query.jobs.findFirst({ where: eq(jobs.id, row.id) }))!;
    }

    it("validates a new version with the render checks, then exports with the published version", async () => {
      const v2 = await importTemplate({
        db,
        storage,
        actor,
        files: await testPackage(key, "1.1.0"),
      });
      const validated = await run({
        kind: templateValidateJob,
        payload: { templateRowId: v2.row.id },
      });
      expect(validated.status).toBe("completed");
      const row = await db.query.templates.findFirst({ where: eq(templates.id, v2.row.id) });
      expect(isPublishable(row!)).toBe(true);

      const pkg = await dbTemplateSource({ db, storage }).get(key);
      const layouts = pkg!.manifest.layouts;
      const slides = ["cover", "text", "list", "data", "cta"].map((id) =>
        sampleSlide(layouts.find((l) => l.id === id)!),
      );
      const clientId = "11111111-1111-4111-8111-111111111111";
      const exported = await run({
        kind: carouselExportJob,
        payload: {
          clientId,
          client: "Rossi",
          content: "Trial",
          version: 1,
          templateId: key,
          slides,
          outputs: ["zip"],
        },
      });
      expect(exported.status, exported.error ?? "").toBe("completed");
      const files = (exported.result as { files: ExportedFile[] }).files;
      expect(files.map((f) => f.name).at(-1)).toBe("rossi_trial_v1_ig-4x5.zip");
      for (const f of files) {
        expect(f.key.startsWith(`clients/${clientId}/exports/`)).toBe(true);
        expect(await storage.exists(f.key)).toBe(true);
      }
    }, 120_000);
  });
});
