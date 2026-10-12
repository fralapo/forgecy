import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientTransferAreas, type Actor } from "@forgecy/core";
import {
  assets,
  auditEvents,
  clients,
  createDb,
  eq,
  inArray,
  users,
  type Database,
} from "@forgecy/db";
import { LocalDiskDriver } from "@forgecy/files";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { clientTables, TABLE_AREAS } from "../src/graph";
import { writeClientPackage, type PackageManifest } from "../src/export";
import { estimateClientExport } from "../src/service";

describe("client tables", () => {
  it("gives every client table an area and puts NOT NULL parents first", () => {
    const tables = clientTables();
    const seen = new Set<string>();
    for (const t of tables) {
      expect(TABLE_AREAS[t.name]).toBeDefined();
      for (const p of t.parents)
        if (p.notNull && p.target !== t.name) expect(seen.has(p.target)).toBe(true);
      seen.add(t.name);
    }
    expect(tables[0]!.name).toBe("clients");
    expect(seen.has("users")).toBe(false);
    expect(seen.has("jobs")).toBe(false);
    expect(seen.has("content_versions")).toBe(true);
    expect(seen.has("automation_run_items")).toBe(true);
  });
});

function readZip(file: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const out = new Map<string, Buffer>();
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on("entry", (entry: yauzl.Entry) =>
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            out.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        }),
      );
      zip.on("end", () => resolve(out));
      zip.readEntry();
    });
  });
}

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("full client export (integration)", () => {
  let db: Database;
  let dir: string;
  let storage: LocalDiskDriver;
  let admin: Extract<Actor, { type: "user" }>;
  const ids: { client?: string; other?: string; user?: string } = {};
  const suffix = Math.random().toString(36).slice(2, 8);
  const sha = (c: string) => c.repeat(64);

  beforeAll(async () => {
    db = createDb(dbUrl!);
    dir = await mkdtemp(join(tmpdir(), "forgecy-transfer-"));
    storage = new LocalDiskDriver({
      root: join(dir, "media"),
      baseUrl: "http://localhost:3000",
      secret: "test-secret-0123456789",
    });
    const [u] = await db
      .insert(users)
      .values({ name: "Ada Export", email: `ada-${suffix}@example.com`, isAdmin: true })
      .returning();
    ids.user = u!.id;
    admin = { type: "user", id: u!.id, isAdmin: true, active: true, clients: "all" as const };
    const [c, o] = await db
      .insert(clients)
      .values([
        { name: `Rossi ${suffix}`, slug: `rossi-${suffix}`, status: "active" },
        { name: `Other ${suffix}`, slug: `other-${suffix}`, status: "active" },
      ])
      .returning();
    ids.client = c!.id;
    ids.other = o!.id;
    const key = (client: string, s: string) => `clients/${client}/assets/${sha(s)}.png`;
    await storage.put(key(c!.id, "a"), Buffer.from("approved"), { contentType: "image/png" });
    await storage.put(key(c!.id, "b"), Buffer.from("ai draft"), { contentType: "image/png" });
    await storage.put(key(o!.id, "c"), Buffer.from("other"), { contentType: "image/png" });
    const base = { mime: "image/png", size: 8, createdBy: u!.id };
    await db.insert(assets).values([
      {
        ...base,
        clientId: c!.id,
        source: "upload",
        status: "approved",
        storageKey: key(c!.id, "a"),
        sha256: sha("a"),
      },
      {
        ...base,
        clientId: c!.id,
        source: "ai",
        status: "draft",
        storageKey: key(c!.id, "b"),
        sha256: sha("b"),
        generation: { prompt: "x" },
      },
      {
        ...base,
        clientId: o!.id,
        source: "upload",
        status: "approved",
        storageKey: key(o!.id, "c"),
        sha256: sha("c"),
      },
    ]);
    await db.insert(auditEvents).values({
      actor: `user:${u!.id}`,
      actorUserId: u!.id,
      action: "client.note",
      entity: "client",
      entityId: c!.id,
      clientId: c!.id,
      meta: { text: 'say "hi", ok' },
    });
  });

  afterAll(async () => {
    if (ids.client) await db.delete(auditEvents).where(eq(auditEvents.clientId, ids.client));
    await db.delete(clients).where(inArray(clients.id, [ids.client!, ids.other!]));
    if (ids.user) await db.delete(users).where(eq(users.id, ids.user));
    await rm(dir, { recursive: true, force: true });
    await db.$client.end();
  });

  it("writes only this client's rows and files, without unapproved AI images", async () => {
    const file = join(dir, "pkg.zip");
    const { manifest, counts } = await writeClientPackage(
      { db, storage },
      {
        clientId: ids.client!,
        areas: [...clientTransferAreas],
        excludeUnapprovedAi: true,
        includeAgencyTemplates: false,
      },
      file,
    );
    const zip = await readZip(file);
    const fromZip = JSON.parse(zip.get("manifest.json")!.toString()) as PackageManifest;
    expect(fromZip).toEqual(manifest);
    expect(manifest.client).toMatchObject({ id: ids.client, slug: `rossi-${suffix}` });
    expect(manifest.schema.migrations).toBeGreaterThan(0);
    expect(counts).toMatchObject({ clients: 1, assets: 1, files: 1 });

    const assetRows = JSON.parse(zip.get("data/assets.json")!.toString()) as { sha256: string }[];
    expect(assetRows.map((a) => a.sha256)).toEqual([sha("a")]);
    expect([...zip.keys()].filter((k) => k.startsWith("files/"))).toEqual([
      `files/clients/${ids.client}/assets/${sha("a")}.png`,
    ]);
    expect(manifest.files[0]).toMatchObject({ bytes: 8 });
    // Nothing of the other client, no secrets, people with name and email only.
    expect([...zip.values()].some((b) => b.toString().includes(ids.other!))).toBe(false);
    expect(JSON.parse(zip.get("people.json")!.toString())).toEqual([
      { id: ids.user, name: "Ada Export", email: `ada-${suffix}@example.com` },
    ]);
    const csv = zip.get("activity.csv")!.toString();
    expect(csv.split("\n")[0]).toBe("at,actor,action,entity,entity_id,meta");
    expect(csv).toContain("Ada Export,client.note");
  });

  it("keeps unapproved AI images when asked and leaves out unchosen areas", async () => {
    const file = join(dir, "pkg2.zip");
    const { manifest } = await writeClientPackage(
      { db, storage },
      {
        clientId: ids.client!,
        areas: ["content"],
        excludeUnapprovedAi: false,
        includeAgencyTemplates: false,
      },
      file,
    );
    expect(manifest.tables.assets?.rows).toBe(2);
    expect(manifest.tables.brand_identity_versions).toBeUndefined();
    expect((await readZip(file)).has("activity.csv")).toBe(false);
  });

  it("refuses an export whose JSON the importer would refuse", async () => {
    const opts = {
      clientId: ids.client!,
      areas: [...clientTransferAreas],
      excludeUnapprovedAi: true,
      includeAgencyTemplates: false,
    };
    const noop = async () => {};
    await expect(
      writeClientPackage({ db, storage }, opts, join(dir, "big1.zip"), noop, {
        jsonBytes: 10,
        jsonTotalBytes: 1 << 20,
      }),
    ).rejects.toThrow(/larger than a package may hold/);
    await expect(
      writeClientPackage({ db, storage }, opts, join(dir, "big2.zip"), noop, {
        jsonBytes: 1 << 20,
        jsonTotalBytes: 100,
      }),
    ).rejects.toThrow(/data of this client is larger/);
  });

  it("estimates rows per area for Admins only", async () => {
    const est = await estimateClientExport(db, admin, ids.client!);
    expect(est.rows.content).toBe(2);
    expect(est.rows.activity).toBe(1);
    expect(est.imageBytes).toBe(16);
    await expect(
      estimateClientExport(db, { ...admin, isAdmin: false }, ids.client!),
    ).rejects.toThrow(/clients\.transfer/);
  });
});
