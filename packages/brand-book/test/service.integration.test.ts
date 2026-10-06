import { defaultTokens, emptyDocument } from "@forgecy/brand";
import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  brandIdentities,
  brandIdentityVersions,
  brandSources,
  clients,
  createDb,
  eq,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { LocalDiskDriver, sha256 } from "@forgecy/files";
import { strFromU8, unzipSync } from "fflate";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportBrandSystem, listBrandBookExports } from "../src/service";

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

async function bytesOf(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

describe.skipIf(!dbUrl)("brand system export (integration)", () => {
  let db: Database;
  let storage: LocalDiskDriver;
  let root: string;
  let clientId: string;
  let versionId: string;
  let anna: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const agent: Actor = { type: "agent", role: "brand_analyst", runId: crypto.randomUUID() };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    root = await mkdtemp(path.join(tmpdir(), "forgecy-bb-"));
    storage = new LocalDiskDriver({
      root,
      baseUrl: "http://localhost:3000",
      secret: "test-secret-0123456789",
    });
    const [c] = await db
      .insert(clients)
      .values({ name: `Test ${suffix}`, slug: `bb-test-${suffix}` })
      .returning();
    clientId = c!.id;
    const [u] = await db
      .insert(users)
      .values({ name: "anna", email: `anna-${suffix}@example.test` })
      .returning();
    anna = { type: "user", id: u!.id, isAdmin: false, active: true };

    const logo = new TextEncoder().encode("<svg/>");
    const key = `clients/${clientId}/brand-sources/${sha256(logo)}.svg`;
    await storage.put(key, logo, { contentType: "image/svg+xml" });
    const [src] = await db
      .insert(brandSources)
      .values({
        clientId,
        kind: "brand_book",
        title: "logo.svg",
        storageKey: key,
        mime: "image/svg+xml",
        size: logo.byteLength,
        sha256: sha256(logo),
        status: "extracted",
      })
      .returning();
    const document = emptyDocument();
    document.visual.logo.variants = [
      { id: "l1", role: "logo_primary", sourceId: src!.id, background: "any" },
    ];
    const [identity] = await db.insert(brandIdentities).values({ clientId }).returning();
    const [v] = await db
      .insert(brandIdentityVersions)
      .values({
        brandIdentityId: identity!.id,
        clientId,
        number: 1,
        status: "published",
        document,
        tokens: defaultTokens(),
        changelog: "First published version",
        approvedBy: anna.id,
        approvedAt: new Date(),
        publishedBy: anna.id,
        publishedAt: new Date(),
      })
      .returning();
    versionId = v!.id;
  });

  afterAll(async () => {
    if (db && clientId) {
      for (const table of [
        "brand_book_exports",
        "brand_identity_versions",
        "brand_identities",
        "brand_sources",
      ])
        await db.execute(sql`delete from ${sql.identifier(table)} where client_id = ${clientId}`);
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("refuses agents and empty part lists", async () => {
    expect(
      await codeOf(exportBrandSystem({ db, storage }, agent, { clientId, parts: ["identity"] })),
    ).toBe("permission_denied");
    expect(await codeOf(exportBrandSystem({ db, storage }, anna, { clientId, parts: [] }))).toBe(
      "validation",
    );
  });

  it("refuses a version that is not approved", async () => {
    expect(
      await codeOf(
        exportBrandSystem({ db, storage }, anna, {
          clientId,
          versionId: crypto.randomUUID(),
          parts: ["identity"],
        }),
      ),
    ).toBe("validation");
  });

  it("stores the ZIP, numbers it BB-n and bundles the logo", async () => {
    const first = await exportBrandSystem({ db, storage }, anna, {
      clientId,
      parts: ["identity", "assets", "sources"],
    });
    expect(first).toMatchObject({
      number: 1,
      type: "brand_system",
      status: "exported",
      brandVersionId: versionId,
      brandVersionNumber: 1,
      parts: ["identity", "sources", "assets"],
      createdBy: anna.id,
    });
    const zip = unzipSync(await bytesOf(await storage.get(first.storageKey!)));
    const dir = first.fileName!.replace(/\.zip$/, "");
    const names = Object.keys(zip);
    expect(names).toHaveLength(4);
    expect(names).toEqual(
      expect.arrayContaining([
        `${dir}/README.md`,
        `${dir}/brand_identity.json`,
        `${dir}/sources.json`,
      ]),
    );
    expect(names.some((n) => /\/assets\/logos\/logo-primary-[0-9a-f]{8}\.svg$/.test(n))).toBe(true);
    const identity = JSON.parse(strFromU8(zip[`${dir}/brand_identity.json`]!));
    expect(identity.version).toMatchObject({ id: versionId, number: 1 });

    const second = await exportBrandSystem({ db, storage }, anna, {
      clientId,
      versionId,
      parts: ["tokens"],
    });
    expect(second.number).toBe(2);
    expect((await listBrandBookExports(db, anna, clientId)).map((r) => r.number)).toEqual([2, 1]);
  });
});
