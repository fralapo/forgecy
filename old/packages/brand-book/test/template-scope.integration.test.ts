import { defaultTokens, emptyDocument } from "@forgecy/brand";
import type { Actor } from "@forgecy/core";
import {
  brandBookExports,
  brandIdentities,
  brandIdentityVersions,
  clients,
  createDb,
  eq,
  inArray,
  jobs,
  sql,
  templates,
  users,
  type Database,
} from "@forgecy/db";
import type { JobContext, JobQueues } from "@forgecy/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClientBook, publishedBookTemplate } from "../src/client-book";
import { runBrandBookRender } from "../src/handlers";
import { BRAND_BOOK_TEMPLATE_KEY } from "../src/parts";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const queues = {
  get: () => ({ add: async (_n: string, _d: unknown, o: { jobId: string }) => ({ id: o.jobId }) }),
  close: async () => {},
} as unknown as JobQueues;

/**
 * ADR 0021: a client's private Brand Book template is pinned and rendered for that client only.
 * Only private versions are added (above any agency one), so the suite that pins the agency
 * version for its own client is not affected when the files run in parallel.
 */
describe.skipIf(!dbUrl)("private Brand Book templates (integration)", () => {
  let db: Database;
  let anna: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const n = Date.now() % 100000;
  const versionA = `7000.${n}.0`;
  const versionB = `7001.${n}.0`;
  const ids: { a?: string; b?: string; versionA?: string } = {};

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    // An Admin reaches every client (ADR 0020): the render job reads the requester's access.
    const [u] = await db
      .insert(users)
      .values({ name: "anna", email: `anna-${suffix}@example.test`, isAdmin: true })
      .returning();
    anna = { type: "user", id: u!.id, isAdmin: true, active: true, clients: "all" };
    const [a, b] = await db
      .insert(clients)
      .values([
        { name: `Book A ${suffix}`, slug: `bts-a-${suffix}` },
        { name: `Book B ${suffix}`, slug: `bts-b-${suffix}` },
      ])
      .returning();
    ids.a = a!.id;
    ids.b = b!.id;
    const [identity] = await db.insert(brandIdentities).values({ clientId: a!.id }).returning();
    const [v] = await db
      .insert(brandIdentityVersions)
      .values({
        brandIdentityId: identity!.id,
        clientId: a!.id,
        number: 1,
        status: "published",
        document: emptyDocument(),
        tokens: defaultTokens(),
        approvedBy: anna.id,
        approvedAt: new Date(),
        publishedBy: anna.id,
        publishedAt: new Date(),
      })
      .returning();
    ids.versionA = v!.id;
    const tpl = (version: string, clientId: string) => ({
      key: BRAND_BOOK_TEMPLATE_KEY,
      version,
      name: "Brand Book",
      kind: "report",
      format: "report_a4",
      clientId,
      status: "published" as const,
      manifest: {},
      packageKey: `templates/scope-${suffix}.zip`,
      packageSha256: "0".repeat(64),
      packageSize: 1,
    });
    await db.insert(templates).values([tpl(versionA, a!.id), tpl(versionB, b!.id)]);
  });

  afterAll(async () => {
    if (db && ids.a && ids.b) {
      await db.delete(brandBookExports).where(eq(brandBookExports.clientId, ids.a));
      await db.delete(jobs).where(eq(jobs.clientId, ids.a));
      for (const table of ["brand_identity_versions", "brand_identities"])
        await db.execute(sql`delete from ${sql.identifier(table)} where client_id = ${ids.a}`);
      await db.execute(
        sql`delete from templates where key = ${BRAND_BOOK_TEMPLATE_KEY} and version in (${versionA}, ${versionB})`,
      );
      await db.delete(clients).where(inArray(clients.id, [ids.a, ids.b]));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("pins the client's own version, never another client's newer one", async () => {
    expect(await publishedBookTemplate(db, ids.a!)).toBe(versionA);
    expect(await publishedBookTemplate(db, ids.b!)).toBe(versionB);
  });

  it("refuses to render a book pinned to another client's private version", async () => {
    const book = await createClientBook({ db, queues }, anna, {
      clientId: ids.a!,
      versionId: ids.versionA!,
      sections: ["visual"],
      language: "en",
    });
    expect(book.templateVersion).toBe(versionA);
    // A row that names B's version (a crafted or stale reference) is treated as missing.
    await db
      .update(brandBookExports)
      .set({ templateVersion: versionB })
      .where(eq(brandBookExports.id, book.id));
    const ctx = {
      db,
      row: { createdBy: anna.id },
      progress: async () => {},
      heartbeat: async () => {},
      isCancelled: async () => false,
    } as unknown as JobContext;
    await expect(
      runBrandBookRender(
        {
          storage: {} as never,
          renderBrowser: async () => {
            throw new Error("refused before rendering");
          },
        },
        { exportId: book.id, final: false },
        ctx,
      ),
    ).rejects.toMatchObject({
      name: "NeedsAttentionError",
      ref: { key: "brand.book.jobErrors.templateMissing" },
    });
  });
});
