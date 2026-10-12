import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultTokens, parseDocument as parseBrandDocument } from "@forgecy/brand";
import type { Actor } from "@forgecy/core";
import {
  brandIdentities,
  brandIdentityVersions,
  clients,
  createDb,
  inArray,
  sql,
  templates,
  users,
  type Database,
} from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCarousel } from "../src/carousels/carousels";
import { getTemplate, listUsableTemplates } from "../src/carousels/templates";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const manifest = JSON.parse(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../templates/carousels/editorial-ig-4x5/template.json",
    ),
    "utf8",
  ),
);

/** ADR 0021: a client's private template is used only for that client's content. */
describe.skipIf(!dbUrl)("private client templates in the content path (integration)", () => {
  let db: Database;
  let anna: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const shared = `scope-${suffix}`;
  const onlyA = `scope-a-${suffix}`;
  const ids: { a?: string; b?: string } = {};

  const row = (key: string, version: string, clientId: string | null) => ({
    key,
    version,
    name: `${key} ${version}`,
    kind: "carousel",
    channel: "instagram",
    format: "ig_4x5",
    clientId,
    status: "published" as const,
    manifest: { ...manifest, id: key, version },
    packageKey: "system/templates/none.zip",
    packageSha256: "0".repeat(64),
    packageSize: 1,
    validation: { ok: true, rendered: true, checks: [], issues: [] },
  });

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    const [u] = await db
      .insert(users)
      .values({ name: "anna", email: `anna-${suffix}@example.test` })
      .returning();
    anna = { type: "user", id: u!.id, isAdmin: false, active: true, clients: "all" };
    const [a, b] = await db
      .insert(clients)
      .values([
        { name: `Scope A ${suffix}`, slug: `scope-a-${suffix}` },
        { name: `Scope B ${suffix}`, slug: `scope-b-${suffix}` },
      ])
      .returning();
    ids.a = a!.id;
    ids.b = b!.id;
    const document = parseBrandDocument({
      strategy: {
        oneLiner: { id: "o1", value: "Bread" },
        audience: [{ id: "seg1", value: { name: "Locals", problems: "Stale bread" } }],
      },
    });
    for (const clientId of [a!.id, b!.id]) {
      const [bi] = await db.insert(brandIdentities).values({ clientId }).returning();
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
    }
    // Agency 1.0.0 for everyone; A and B each hold a private version of the same key.
    await db
      .insert(templates)
      .values([
        row(shared, "1.0.0", null),
        row(shared, "2.0.0", a!.id),
        row(shared, "3.0.0", b!.id),
        row(onlyA, "1.0.0", a!.id),
      ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(templates).where(inArray(templates.key, [shared, onlyA]));
      const own = [ids.a, ids.b].filter((x): x is string => !!x);
      if (own.length) await db.delete(clients).where(inArray(clients.id, own));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("resolves each client's own version of a shared key", async () => {
    expect((await getTemplate(db, ids.a!, shared)).version).toBe("2.0.0");
    expect((await getTemplate(db, ids.b!, shared)).version).toBe("3.0.0");
    expect((await getTemplate(db, ids.b!, shared, "1.0.0")).version).toBe("1.0.0");
  });

  it("treats another client's private version as unavailable", async () => {
    for (const [clientId, version] of [
      [ids.a!, "3.0.0"],
      [ids.b!, "2.0.0"],
    ] as const)
      await expect(getTemplate(db, clientId, shared, version)).rejects.toMatchObject({
        ref: { key: "content.errors.templateUnavailable" },
      });
    await expect(getTemplate(db, ids.b!, onlyA)).rejects.toMatchObject({
      ref: { key: "content.errors.templateUnavailable" },
    });
  });

  it("lists the agency templates and the client's own only", async () => {
    const forA = await listUsableTemplates(db, ids.a!);
    const forB = await listUsableTemplates(db, ids.b!);
    const mine = (list: typeof forA) =>
      list.filter((t) => t.key === shared || t.key === onlyA).map((t) => `${t.key}@${t.version}`);
    expect(mine(forA).sort()).toEqual([`${onlyA}@1.0.0`, `${shared}@2.0.0`].sort());
    expect(mine(forB)).toEqual([`${shared}@3.0.0`]);
  });

  it("refuses a carousel for B that names A's private template", async () => {
    await expect(
      createCarousel(db, anna, {
        clientId: ids.b!,
        params: {
          objective: "education",
          audienceIds: ["seg1"],
          channel: "instagram",
          format: "ig_4x5",
          templateKey: onlyA,
          slideCount: 5,
        },
      }),
    ).rejects.toMatchObject({ ref: { key: "content.errors.templateUnavailable" } });
  });
});
