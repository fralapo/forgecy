import { defaultTokens, emptyDocument } from "@forgecy/brand";
import { ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  brandBookExports,
  brandIdentities,
  brandIdentityVersions,
  clients,
  createDb,
  eq,
  jobs,
  sql,
  templates,
  users,
  type Database,
} from "@forgecy/db";
import type { JobQueues } from "@forgecy/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveClientBook,
  createClientBook,
  exportClientBook,
  recordClientBookFile,
  rerenderClientBook,
} from "../src/client-book";
import { BRAND_BOOK_TEMPLATE_KEY } from "../src/parts";

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
function fakeQueues() {
  const added: string[] = [];
  const queues = {
    get: () => ({
      add: async (_name: string, _data: unknown, opts: { jobId: string }) => {
        added.push(opts.jobId);
        return { id: opts.jobId };
      },
    }),
    close: async () => {},
  } as unknown as JobQueues;
  return { queues, added };
}

describe.skipIf(!dbUrl)("client Brand Book flow (integration)", () => {
  let db: Database;
  let clientId: string;
  let versionId: string;
  let anna: Extract<Actor, { type: "user" }>;
  let marco: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const templateVersion = `999.${Date.now() % 100000}.0`;
  const agent: Actor = { type: "agent", role: "brand_analyst", runId: crypto.randomUUID() };
  const { queues, added } = fakeQueues();

  const finalFile = (exportId: string, n: number) => ({
    exportId,
    final: true,
    storageKey: `clients/${clientId}/brand-book/final-${n}.pdf`,
    fileName: `book-${n}.pdf`,
    bytes: 100,
    pages: 12,
  });

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const [c] = await db
      .insert(clients)
      .values({ name: `Book ${suffix}`, slug: `cb-test-${suffix}` })
      .returning();
    clientId = c!.id;
    const people = await db
      .insert(users)
      .values([
        { name: "anna", email: `anna-${suffix}@example.test` },
        { name: "marco", email: `marco-${suffix}@example.test` },
      ])
      .returning();
    anna = {
      type: "user",
      id: people[0]!.id,
      isAdmin: false,
      active: true,
      clients: "all" as const,
    };
    marco = {
      type: "user",
      id: people[1]!.id,
      isAdmin: false,
      active: true,
      clients: "all" as const,
    };
    const [identity] = await db.insert(brandIdentities).values({ clientId }).returning();
    const [v] = await db
      .insert(brandIdentityVersions)
      .values({
        brandIdentityId: identity!.id,
        clientId,
        number: 1,
        status: "published",
        document: emptyDocument(),
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
      await db.delete(brandBookExports).where(eq(brandBookExports.clientId, clientId));
      await db.delete(jobs).where(eq(jobs.clientId, clientId));
      for (const table of ["brand_identity_versions", "brand_identities"])
        await db.execute(sql`delete from ${sql.identifier(table)} where client_id = ${clientId}`);
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
      await db.execute(
        sql`delete from templates where key = ${BRAND_BOOK_TEMPLATE_KEY} and version = ${templateVersion}`,
      );
    }
    await db?.$client.end();
  });

  it("needs a published Brand Book template", async () => {
    const existing = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.key, BRAND_BOOK_TEMPLATE_KEY));
    if (existing.length === 0)
      expect(
        await codeOf(
          createClientBook({ db, queues }, anna, {
            clientId,
            versionId,
            sections: ["visual"],
            language: "en",
          }),
        ),
      ).toBe("validation");
    await db.insert(templates).values({
      key: BRAND_BOOK_TEMPLATE_KEY,
      version: templateVersion,
      name: "Brand Book test",
      kind: "report",
      format: "report_a4",
      status: "published",
      manifest: {},
      packageKey: `templates/test-${suffix}.zip`,
      packageSha256: "0".repeat(64),
      packageSize: 1,
    });
  });

  it("refuses agents and empty section lists", async () => {
    const input = { clientId, versionId, sections: ["visual"], language: "en" as const };
    expect(await codeOf(createClientBook({ db, queues }, agent, input))).toBe("permission_denied");
    expect(await codeOf(createClientBook({ db, queues }, anna, { ...input, sections: [] }))).toBe(
      "validation",
    );
  });

  it("drafts, approves with a note, exports and supersedes the previous book", async () => {
    const first = await createClientBook({ db, queues }, anna, {
      clientId,
      versionId,
      sections: ["visual", "strategy"],
      language: "it",
    });
    expect(first).toMatchObject({
      number: 1,
      type: "client_book",
      status: "draft",
      templateVersion,
      language: "it",
      parts: ["strategy", "visual"],
    });
    const [queued] = await db.select().from(jobs).where(eq(jobs.entityId, first.id));
    expect(queued).toMatchObject({ kind: "brand_book.render", payload: { final: false } });
    expect(added).toContain(queued!.id);

    // Nothing to approve before the preview exists.
    expect(
      await codeOf(approveClientBook(db, marco, { clientId, exportId: first.id, note: null })),
    ).toBe("conflict");
    await recordClientBookFile(db, {
      ...finalFile(first.id, 0),
      final: false,
      storageKey: "preview.pdf",
    });
    await rerenderClientBook({ db, queues }, anna, { clientId, exportId: first.id });

    // Approving your own book needs a note; agents never approve.
    expect(
      await codeOf(approveClientBook(db, anna, { clientId, exportId: first.id, note: "ok" })),
    ).toBe("validation");
    expect(await codeOf(approveClientBook(db, agent, { clientId, exportId: first.id }))).toBe(
      "permission_denied",
    );
    expect(
      await codeOf(exportClientBook({ db, queues }, anna, { clientId, exportId: first.id })),
    ).toBe("conflict");
    const approved = await approveClientBook(db, anna, {
      clientId,
      exportId: first.id,
      note: "Checked every page with the client on the call",
    });
    expect(approved).toMatchObject({ status: "approved", approvedBy: anna.id });

    await exportClientBook({ db, queues }, anna, { clientId, exportId: first.id });
    await recordClientBookFile(db, finalFile(first.id, 1));

    const second = await createClientBook({ db, queues }, marco, {
      clientId,
      versionId,
      sections: ["visual"],
      language: "en",
    });
    expect(second.number).toBe(2);
    await recordClientBookFile(db, {
      ...finalFile(second.id, 0),
      final: false,
      storageKey: "p2.pdf",
    });
    // Someone else's book: no note needed.
    await approveClientBook(db, anna, { clientId, exportId: second.id });
    await recordClientBookFile(db, finalFile(second.id, 2));

    const rows = await db
      .select({ number: brandBookExports.number, status: brandBookExports.status })
      .from(brandBookExports)
      .where(eq(brandBookExports.clientId, clientId))
      .orderBy(brandBookExports.number);
    expect(rows).toEqual([
      { number: 1, status: "superseded" },
      { number: 2, status: "exported" },
    ]);
  });
});
