import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientTransferAreas, type Actor } from "@forgecy/core";
import { zipArchive, type ZipEntrySpec } from "@forgecy/core/testing/archives";
import {
  and,
  appSettings,
  assets,
  brandIdentities,
  clientImports,
  clients,
  contentApprovals,
  contents,
  contentVersions,
  createDb,
  eq,
  inArray,
  templates,
  users,
  type Database,
} from "@forgecy/db";
import { LocalDiskDriver, sha256 } from "@forgecy/files";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeClientPackage } from "../src/export";
import { importClientPackage } from "../src/import";
import { openClientPackage } from "../src/package";
import { UnsafePackageError } from "../src/safety";
import { confirmClientImport } from "../src/service";
import { stricterAiPolicy } from "../src/trust";
import { verifyClientPackage } from "../src/verify";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("full client import (integration)", () => {
  let db: Database;
  let dir: string;
  let storage: LocalDiskDriver;
  let admin: Extract<Actor, { type: "user" }>;
  let pkgFile: string;
  const suffix = Math.random().toString(36).slice(2, 8);
  const sha = (c: string) => c.repeat(64);
  const tplKey = `tpl-${suffix}`;
  const ids: {
    client?: string;
    here?: string;
    gone?: string;
    imported?: string;
    imported2?: string;
    imported3?: string;
  } = {};
  const importIds: string[] = [];

  beforeAll(async () => {
    db = createDb(dbUrl!);
    dir = await mkdtemp(join(tmpdir(), "forgecy-import-"));
    storage = new LocalDiskDriver({
      root: join(dir, "media"),
      baseUrl: "http://localhost:3000",
      secret: "test-secret-0123456789",
    });
    const [here, gone] = await db
      .insert(users)
      .values([
        { name: "Ada Here", email: `ada-${suffix}@example.com`, isAdmin: true },
        { name: "Bruno Gone", email: `bruno-${suffix}@example.com` },
      ])
      .returning();
    ids.here = here!.id;
    ids.gone = gone!.id;
    admin = { type: "user", id: here!.id, isAdmin: true, active: true };

    const [c] = await db
      .insert(clients)
      .values({ name: `Rossi ${suffix}`, slug: `rossi-${suffix}`, status: "active" })
      .returning();
    ids.client = c!.id;
    await db.insert(brandIdentities).values({ clientId: c!.id });
    const assetKey = `clients/${c!.id}/assets/${sha("a")}.png`;
    await storage.put(assetKey, Buffer.from("approved"), { contentType: "image/png" });
    await db.insert(assets).values({
      clientId: c!.id,
      source: "upload",
      status: "approved",
      storageKey: assetKey,
      sha256: sha("a"),
      mime: "image/png",
      size: 8,
      createdBy: gone!.id,
    });
    const tplStorage = `system/templates/${sha("t")}.zip`;
    await storage.put(tplStorage, Buffer.from("zip"), { contentType: "application/zip" });
    await db.insert(templates).values({
      key: tplKey,
      version: "1.0.0",
      name: "Rossi cover",
      kind: "carousel",
      format: "instagram_4_5",
      clientId: c!.id,
      status: "published",
      manifest: {},
      packageKey: tplStorage,
      packageSha256: sha("t"),
      packageSize: 3,
    });
    const [content] = await db
      .insert(contents)
      .values({
        clientId: c!.id,
        title: "Launch",
        status: "in_review",
        objective: "awareness",
        channel: "instagram",
        format: "instagram_4_5",
        templateKey: tplKey,
        templateVersion: "1.0.0",
        createdBy: here!.id,
      })
      .returning();
    const [v1] = await db
      .insert(contentVersions)
      .values({
        contentId: content!.id,
        number: 1,
        document: { slides: [], image: assetKey },
        createdFrom: "manual",
        meta: { templateKey: tplKey, templateVersion: "1.0.0" },
      })
      .returning();
    await db.update(contents).set({ currentVersionId: v1!.id }).where(eq(contents.id, content!.id));
    await db.insert(contentApprovals).values([
      { contentId: content!.id, versionId: v1!.id, decision: "approved", decidedBy: here!.id },
      { contentId: content!.id, versionId: v1!.id, decision: "approved", decidedBy: gone!.id },
    ]);

    pkgFile = join(dir, "pkg.zip");
    await writeClientPackage(
      { db, storage },
      {
        clientId: c!.id,
        areas: [...clientTransferAreas],
        excludeUnapprovedAi: true,
        includeAgencyTemplates: false,
      },
      pkgFile,
    );
    // As if the package went to another installation: Bruno is not a user there, and the
    // template exists only in an older version.
    await db
      .update(users)
      .set({ email: `bruno-elsewhere-${suffix}@example.com` })
      .where(eq(users.id, gone!.id));
    await db.update(templates).set({ version: "0.9.0" }).where(eq(templates.key, tplKey));
  });

  afterAll(async () => {
    if (importIds.length)
      await db.delete(clientImports).where(inArray(clientImports.id, importIds));
    const own = [ids.client, ids.imported, ids.imported2, ids.imported3].filter(
      (x): x is string => !!x,
    );
    await db.delete(templates).where(eq(templates.key, tplKey));
    if (own.length) await db.delete(clients).where(inArray(clients.id, own));
    await db.delete(users).where(inArray(users.id, [ids.here!, ids.gone!]));
    await rm(dir, { recursive: true, force: true });
    await db.$client.end();
  });

  it("verifies the package and lists the conflicts", async () => {
    const v = await verifyClientPackage(db, pkgFile, 100);
    expect(v.problems).toEqual([]);
    expect(v.report).toMatchObject({
      client: { slug: `rossi-${suffix}` },
      counts: { templates: 1, files: 2 },
    });
    expect(v.conflicts).toEqual([
      expect.objectContaining({
        kind: "client",
        existingId: ids.client,
        proposedSlug: `rossi-${suffix}-2`,
      }),
      // The matching client's own 0.9.0 is private to it: a new client cannot reuse it, so there
      // is no template conflict to choose about (the import decides the same way).
    ]);
    expect(v.resolved).toEqual(
      expect.arrayContaining([
        { kind: "authorMatched", name: "Ada Here", email: `ada-${suffix}@example.com` },
        { kind: "authorMissing", name: "Bruno Gone", email: `bruno-${suffix}@example.com` },
      ]),
    );
  });

  it("rejects a file that is not a package", async () => {
    const bad = join(dir, "bad.zip");
    await writeFile(bad, "not a zip");
    expect((await verifyClientPackage(db, bad, 9)).problems).toEqual(["unreadable"]);
  });

  it("imports as a new client with new ids, mapped people and files", async () => {
    const out = await importClientPackage({ db, storage }, pkgFile, {
      choices: {
        client: { mode: "new", slug: `rossi-${suffix}-2` },
        templates: { [`${tplKey}@1.0.0`]: "importDraft" },
      },
    });
    ids.imported = out.clientId;
    expect(out.clientId).not.toBe(ids.client);
    expect(out.slug).toBe(`rossi-${suffix}-2`);
    expect(out.summary).toEqual({ versions: 0, carousels: 1, audits: 0 });

    const [content] = await db.select().from(contents).where(eq(contents.clientId, out.clientId));
    // In review goes back to Draft; the cycle contents ↔ versions is restored.
    expect(content!.status).toBe("draft");
    const [version] = await db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.contentId, content!.id));
    expect(content!.currentVersionId).toBe(version!.id);
    const newKey = `clients/${out.clientId}/assets/${sha("a")}.png`;
    expect(version!.document).toEqual({ slides: [], image: newKey });
    expect(await storage.exists(newKey)).toBe(true);
    // Approvals are claims of the other installation: none are imported.
    const approvals = await db
      .select()
      .from(contentApprovals)
      .where(eq(contentApprovals.contentId, content!.id));
    expect(approvals).toEqual([]);
    expect(content!.approvedVersionId).toBeNull();
    const [asset] = await db.select().from(assets).where(eq(assets.clientId, out.clientId));
    expect(asset!.createdBy).toBeNull();
    const [tpl] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.key, tplKey), eq(templates.version, "1.0.0")));
    expect(tpl).toMatchObject({ status: "draft", clientId: out.clientId, publishedAt: null });
  });

  /** The package with some table rows edited; table hashes stay honest (hostile, not damaged). */
  const rewrite = async (
    label: string,
    edits: Record<string, (row: Record<string, unknown>) => void>,
  ) => {
    const src = await openClientPackage(pkgFile);
    const files = new Map<string, Buffer>();
    for (const name of src.names()) {
      const chunks: Buffer[] = [];
      for await (const c of await src.stream(name)) chunks.push(c as Buffer);
      files.set(name, Buffer.concat(chunks));
    }
    src.close();
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
    for (const [table, edit] of Object.entries(edits)) {
      const rows = JSON.parse(files.get(`data/${table}.json`)!.toString("utf8")) as Record<
        string,
        unknown
      >[];
      rows.forEach(edit);
      const data = Buffer.from(JSON.stringify(rows));
      files.set(`data/${table}.json`, data);
      manifest.tables[table].sha256 = sha256(data);
    }
    files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
    const out = join(dir, `${label}.zip`);
    await writeFile(out, zipArchive([...files].map(([name, data]) => ({ name, data }))));
    return out;
  };

  it("brings an approved carousel, a published template and AI consent in as drafts and nothing", async () => {
    const version = "9.0.0";
    const approved = await rewrite("approved", {
      clients: (r) =>
        Object.assign(r, { ai_policy: "external_allowed", approved_providers: ["openai"] }),
      contents: (r) =>
        Object.assign(r, {
          status: "approved",
          approved_version_id: r.current_version_id,
          template_version: version,
        }),
      templates: (r) => Object.assign(r, { status: "published", origin: "system", version }),
    });
    const out = await importClientPackage({ db, storage }, approved, {
      choices: { client: { mode: "new", slug: `rossi-${suffix}-3` }, templates: {} },
    });
    ids.imported2 = out.clientId;
    const [content] = await db.select().from(contents).where(eq(contents.clientId, out.clientId));
    expect(content).toMatchObject({ status: "draft", approvedVersionId: null });
    const [tpl] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.key, tplKey), eq(templates.clientId, out.clientId)));
    expect(tpl).toMatchObject({ status: "draft", origin: "agency", publishedAt: null });
    const [client] = await db.select().from(clients).where(eq(clients.id, out.clientId));
    expect(client!.approvedProviders).toEqual([]);
    // The package asked for external_allowed: a new client never gets more than the installation gives.
    const [setting] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "ai.default_policy"));
    expect(client!.aiPolicy).toBe(
      stricterAiPolicy(
        "external_allowed",
        typeof setting?.value === "string" ? setting.value : "external_allowed",
      ),
    );
    expect(client!.sendableAssets).toEqual([
      "brand_assets",
      "client_photos",
      "audit_screenshots",
      "documents",
      "brand_texts",
    ]);
  });

  it("gives a private template a free version when another client's holds it", async () => {
    // The first import left a private 1.0.0 of this key with another client.
    const out = await importClientPackage({ db, storage }, pkgFile, {
      choices: { client: { mode: "new", slug: `rossi-${suffix}-4` }, templates: {} },
    });
    ids.imported3 = out.clientId;
    const [tpl] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.key, tplKey), eq(templates.clientId, out.clientId)));
    expect(tpl).toMatchObject({ version: "1.0.0-import.1", status: "draft" });
    // The stored manifest is left as it came: the catalog parses it with the strict x.y.z rule.
    expect(tpl!.manifest).toEqual({});
    const [content] = await db.select().from(contents).where(eq(contents.clientId, out.clientId));
    expect(content!.templateVersion).toBe("1.0.0-import.1");
    // The version a carousel was made with is also in its versions' meta; export prefers it.
    const [version] = await db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.contentId, content!.id));
    expect(version!.meta).toMatchObject({ templateKey: tplKey, templateVersion: "1.0.0-import.1" });
  });

  it("blocks a package that points rows at a client that is not in it", async () => {
    const hostile = await rewrite("hostile", { contents: (r) => (r.client_id = randomUUID()) });
    expect((await verifyClientPackage(db, hostile, 1)).problems).toEqual(["unsafe"]);
  });

  it("replaces an existing client in place, keeping its id, slug, own templates and AI consent", async () => {
    await db
      .update(clients)
      .set({ aiPolicy: "local_only", approvedProviders: [], sendableAssets: ["brand_texts"] })
      .where(eq(clients.id, ids.client!));
    const out = await importClientPackage({ db, storage }, pkgFile, {
      choices: { client: { mode: "replace" }, templates: {} },
      replaceClientId: ids.client!,
    });
    expect(out).toMatchObject({ clientId: ids.client, slug: `rossi-${suffix}` });
    const rows = await db.select().from(contents).where(eq(contents.clientId, ids.client!));
    expect(rows).toHaveLength(1);
    const [old] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.key, tplKey), eq(templates.version, "0.9.0")));
    expect(old!.clientId).toBe(ids.client);
    const [kept] = await db.select().from(clients).where(eq(clients.id, ids.client!));
    expect(kept).toMatchObject({
      aiPolicy: "local_only",
      approvedProviders: [],
      sendableAssets: ["brand_texts"],
    });
  });

  /** The package rewritten entry by entry (the zip builder lets an entry lie about its size). */
  const repack = async (
    mutate: (name: string, data: Buffer) => Partial<ZipEntrySpec>,
    label: string,
  ) => {
    const src = await openClientPackage(pkgFile);
    const entries: ZipEntrySpec[] = [];
    for (const name of src.names()) {
      const chunks: Buffer[] = [];
      for await (const c of await src.stream(name)) chunks.push(c as Buffer);
      const data = Buffer.concat(chunks);
      entries.push({ name, data, ...mutate(name, data) });
    }
    src.close();
    const out = join(dir, `${label}.zip`);
    await writeFile(out, zipArchive(entries));
    return out;
  };

  it("fails the import when a file does not match its checksum and leaves no stored key", async () => {
    const stored: string[] = [];
    const recording = new Proxy(storage, {
      get(target, prop) {
        if (prop === "put")
          return (key: string, ...rest: unknown[]) => {
            stored.push(key);
            return (target.put as (...a: unknown[]) => Promise<void>)(key, ...rest);
          };
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const bad = await repack(
      (name, data) => (name.startsWith("files/") ? { data: Buffer.alloc(data.length, 0x41) } : {}),
      "tampered",
    );
    const slug = `rossi-${suffix}-bad`;
    await expect(
      importClientPackage({ db, storage: recording }, bad, {
        choices: {
          client: { mode: "new", slug },
          templates: { [`${tplKey}@1.0.0`]: "importDraft" },
        },
      }),
    ).rejects.toBeInstanceOf(UnsafePackageError);
    expect(stored.length).toBeGreaterThan(0);
    for (const key of stored) expect(await storage.exists(key)).toBe(false);
    expect(await db.select().from(clients).where(eq(clients.slug, slug))).toEqual([]);
  });

  it("verify reports an entry with a lying size as a problem instead of throwing", async () => {
    const lying = await repack(
      (name, data) =>
        name.startsWith("files/") ? { declaredSize: Math.max(1, data.length - 1) } : {},
      "lying",
    );
    expect((await verifyClientPackage(db, lying, 1)).problems).toEqual(["unreadable"]);
  });

  it("asks for a choice on every conflict and the exact name to replace", async () => {
    const [row] = await db
      .insert(clientImports)
      .values({
        fileName: "pkg.zip",
        storageKey: "imports/clients/x/package.zip",
        bytes: 1,
        status: "ready",
        conflicts: [
          {
            kind: "client",
            name: `Rossi ${suffix}`,
            slug: `rossi-${suffix}`,
            existingId: ids.client!,
            existingName: `Rossi ${suffix}`,
            proposedSlug: `rossi-${suffix}-3`,
          },
          { kind: "template", key: tplKey, version: "2.0.0", name: "x", existingVersions: [] },
        ],
      })
      .returning();
    importIds.push(row!.id);
    // Every check below fails before anything is queued.
    const deps = { db, queues: {} as never };
    const confirm = (actor: Actor, choices: unknown, confirmName?: string) =>
      confirmClientImport(deps, actor, row!.id, { choices, confirmName });
    await expect(
      confirm(admin, { client: { mode: "replace" }, templates: {} }, "Rossi"),
    ).rejects.toMatchObject({ ref: { key: "clientTransfer.errors.typedNameMismatch" } });
    await expect(
      confirm(admin, { client: { mode: "new", slug: `rossi-${suffix}` }, templates: {} }),
    ).rejects.toMatchObject({ ref: { key: "clientTransfer.errors.slugTaken" } });
    await expect(
      confirm(admin, { client: { mode: "new", slug: `rossi-${suffix}-3` }, templates: {} }),
    ).rejects.toMatchObject({ ref: { key: "clientTransfer.errors.unresolvedConflicts" } });
    await expect(
      confirm({ type: "agent", role: "reviewer" }, { client: { mode: "replace" } }),
    ).rejects.toThrow(/clients\.transfer/);
    const [still] = await db.select().from(clientImports).where(eq(clientImports.id, row!.id));
    expect(still!.status).toBe("ready");
  });
});
