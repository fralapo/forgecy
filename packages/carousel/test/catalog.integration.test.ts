import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Actor } from "@forgecy/core";
import { clients, createDb, eq, inArray, jobs, templates, users, type Database } from "@forgecy/db";
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
  let userId: string;
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
    userId = user!.id;
    actor = { type: "user", id: user!.id, isAdmin: false, active: true, clients: "all" as const };
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

    const pkg = await dbTemplateSource({ db, storage, clientId: null }).get(key);
    expect(pkg?.manifest.id).toBe(key);
    expect(pkg?.manifest.layouts).toHaveLength(10);
    expect(
      await dbTemplateSource({ db, storage, clientId: null }).get(key, "9.9.9"),
    ).toBeUndefined();

    // A client's private template is served to that client only, by key alone or by version.
    const [owner] = await db.insert(clients).values({ name: key, slug: key }).returning();
    try {
      await db.update(templates).set({ clientId: owner!.id }).where(eq(templates.id, first.row.id));
      for (const version of [undefined, "1.0.0"]) {
        expect(
          await dbTemplateSource({ db, storage, clientId: null }).get(key, version),
        ).toBeUndefined();
        expect(
          await dbTemplateSource({ db, storage, clientId: randomUUID() }).get(key, version),
        ).toBeUndefined();
        expect(
          (await dbTemplateSource({ db, storage, clientId: owner!.id }).get(key, version))?.manifest
            .id,
        ).toBe(key);
      }
    } finally {
      await db.update(templates).set({ clientId: null }).where(eq(templates.id, first.row.id));
      await db.delete(clients).where(eq(clients.id, owner!.id));
    }
  });

  it("serves each client its own private template sharing a key, never another client's", async () => {
    // Key and version are unique across the installation, so two clients' private templates
    // with one key differ in version (the client import renames a taken one `-import.n`).
    const shared = `${key}-shared`;
    const made = await db
      .insert(clients)
      .values(["a", "b", "c"].map((x) => ({ name: `${shared}-${x}`, slug: `${shared}-${x}` })))
      .returning();
    const [a, b, c] = made;
    const exportFor = (clientId: string, templateVersion?: string) =>
      carouselHandlers({
        storage,
        browser: async () => {
          throw new Error("refused before rendering");
        },
      })["carousel.export"](
        {
          clientId,
          client: "x",
          content: "x",
          version: 1,
          templateId: shared,
          ...(templateVersion ? { templateVersion } : {}),
          slides: [],
          outputs: ["zip"],
        } as never,
        { db } as never,
      );
    try {
      const agency = await importTemplate({ db, storage, actor, files: await testPackage(shared) });
      const mineA = await importTemplate({
        db,
        storage,
        actor,
        files: await testPackage(shared, "2.0.0"),
      });
      const mineB = await importTemplate({
        db,
        storage,
        actor,
        files: await testPackage(shared, "3.0.0"),
      });
      await db.update(templates).set({ status: "published" }).where(eq(templates.key, shared));
      await db.update(templates).set({ clientId: a!.id }).where(eq(templates.id, mineA.row.id));
      await db.update(templates).set({ clientId: b!.id }).where(eq(templates.id, mineB.row.id));
      const served = async (clientId: string | null, version?: string) =>
        (await dbTemplateSource({ db, storage, clientId }).get(shared, version))?.manifest.version;

      // By key alone, each client gets the newest version it may use: its own, else the agency's.
      expect(await served(a!.id)).toBe("2.0.0");
      expect(await served(b!.id)).toBe("3.0.0");
      expect(await served(c!.id)).toBe("1.0.0");
      expect(await served(null)).toBe("1.0.0");
      // A pinned version of another client's private template is never served.
      expect(await served(a!.id, "3.0.0")).toBeUndefined();
      expect(await served(b!.id, "2.0.0")).toBeUndefined();
      expect(await served(null, "2.0.0")).toBeUndefined();
      expect(await served(b!.id, "1.0.0")).toBe("1.0.0");
      // The export job refuses it the same way, before any rendering.
      await expect(exportFor(b!.id, "2.0.0")).rejects.toMatchObject({
        name: "NeedsAttentionError",
        ref: { key: "jobs.errors.templateVersionNotFound" },
      });
      // Without the agency version, a client with no template of its own gets nothing by key.
      await db.update(templates).set({ status: "archived" }).where(eq(templates.id, agency.row.id));
      expect(await served(c!.id)).toBeUndefined();
      expect(await served(a!.id)).toBe("2.0.0");
      await expect(exportFor(c!.id)).rejects.toMatchObject({
        ref: { key: "jobs.errors.templateIdNotFound" },
      });

      // An agency upload of a version a client's private draft holds never replaces its package.
      const draft = await importTemplate({
        db,
        storage,
        actor,
        files: await testPackage(shared, "4.0.0"),
      });
      await db.update(templates).set({ clientId: a!.id }).where(eq(templates.id, draft.row.id));
      const changed = await testPackage(shared, "4.0.0");
      const m = JSON.parse(dec.decode(changed.get("template.json")!));
      changed.set("template.json", enc.encode(JSON.stringify({ ...m, name: "Agency upload" })));
      await expect(importTemplate({ db, storage, actor, files: changed })).rejects.toMatchObject({
        ref: { key: "templates.errors.versionPrivate" },
      });
      const after = await db.query.templates.findFirst({ where: eq(templates.id, draft.row.id) });
      expect(after).toMatchObject({
        clientId: a!.id,
        packageSha256: draft.row.packageSha256,
        name: draft.row.name,
      });
    } finally {
      await db.delete(templates).where(eq(templates.key, shared));
      await db.delete(clients).where(
        inArray(
          clients.id,
          made.map((x) => x.id),
        ),
      );
    }
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

    it("publishes the draft as the requester once the checks pass (one-click starter install)", async () => {
      const v = await importTemplate({
        db,
        storage,
        actor,
        files: await testPackage(key, "1.2.0"),
      });
      const done = await run({
        kind: templateValidateJob,
        payload: {
          templateRowId: v.row.id,
          publish: { by: userId, notes: "Starter template installed" },
        },
      });
      expect(done.status, done.error ?? "").toBe("completed");
      const row = await db.query.templates.findFirst({ where: eq(templates.id, v.row.id) });
      expect(row).toMatchObject({ status: "published", publishedBy: userId });
    }, 120_000);

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

      const pkg = await dbTemplateSource({ db, storage, clientId: null }).get(key);
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
