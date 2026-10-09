import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAiGateway,
  createDbLedger,
  createFakeTextProvider,
  type ImageGenerationInput,
  type ImageProvider,
} from "@forgecy/ai";
import { defaultTokens, parseDocument as parseBrandDocument } from "@forgecy/brand";
import {
  aiConnections,
  assets,
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
import { runGenerateImage, type PipelineDeps } from "../src/ai/pipeline";
import { IMAGE_REFERENCES_NOTE } from "../src/ai/prompts";
import { createCarousel } from "../src/carousels/carousels";

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
// A real 1x1 PNG: the generated image is stored like any other asset.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!dbUrl)("brand images as references for image generation (integration)", () => {
  let db: Database;
  let clientId: string;
  let userId: string;
  let contentId: string;
  const suffix = Math.random().toString(36).slice(2, 8);
  const templateKey = `test-refs-${suffix}`;
  const text = createFakeTextProvider("anthropic");
  const seen: ImageGenerationInput[] = [];
  const image: ImageProvider = {
    id: "openrouter",
    acceptsReferences: true,
    async generate(input) {
      seen.push(input);
      return {
        jobId: `j-${seen.length}`,
        state: "succeeded",
        images: [{ data: new Uint8Array(PNG), mimeType: "image/png" }],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          images: 1,
        },
        model: input.model,
      };
    },
    async getStatus(jobId) {
      return { jobId, state: "failed" };
    },
  };
  let deps: PipelineDeps;
  let n = 0;

  const run = async () => {
    const [j] = await db
      .insert(jobs)
      .values({ kind: "content.generate_image", status: "running", clientId })
      .returning({ id: jobs.id });
    text.push({ json: { prompt: "A steel bottle on a rock at dawn", alt: "A bottle" } });
    seen.length = 0;
    // Another run on the same slide must not collide with the image of the previous one.
    await db.execute(sql`delete from assets where client_id = ${clientId} and source = 'ai'`);
    await runGenerateImage(
      deps,
      { jobId: j!.id, requestedBy: userId, progress: async () => {} },
      { clientId, contentId, slideId: "s1", slot: "image", brief: "bottle outdoors", variants: 1 },
    );
    return seen[0]!;
  };
  /** A website picture a person attested the rights of: approved, with its file on disk. */
  const siteAsset = async (over: Partial<typeof assets.$inferInsert> = {}) => {
    n++;
    const storageKey = `clients/${clientId}/assets/${suffix}-ref-${n}.png`;
    await deps.storage.put(storageKey, new Uint8Array(PNG), {
      contentType: "image/png",
      contentLength: PNG.length,
    });
    await db.insert(assets).values({
      clientId,
      source: "site",
      status: "approved",
      storageKey,
      sha256: `${suffix}-ref-${n}`,
      mime: "image/png",
      size: PNG.length,
      rights: { basis: "own" },
      tags: ["product", "site"],
      ...over,
    });
  };

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const [c] = await db
      .insert(clients)
      .values({ name: `Refs ${suffix}`, slug: `content-refs-${suffix}` })
      .returning();
    clientId = c!.id;
    const [u] = await db
      .insert(users)
      .values({ name: "ines", email: `ines-${suffix}@example.test` })
      .returning();
    userId = u!.id;
    await db.insert(clientAccess).values({ userId, clientId });
    const [bi] = await db.insert(brandIdentities).values({ clientId }).returning();
    await db.insert(brandIdentityVersions).values({
      brandIdentityId: bi!.id,
      clientId,
      number: 1,
      status: "published",
      document: parseBrandDocument({
        strategy: { audience: [{ id: "seg1", value: { name: "Hikers", problems: "Warm water" } }] },
      }) as unknown as Record<string, unknown>,
      tokens: defaultTokens(),
      approvedBy: userId,
      approvedAt: new Date(),
      publishedBy: userId,
      publishedAt: new Date(),
    });
    await db.insert(templates).values({
      key: templateKey,
      version: manifest.version,
      name: "Refs test",
      kind: "carousel",
      channel: "instagram",
      format: "ig_4x5",
      status: "published",
      manifest: { ...manifest, id: templateKey },
      packageKey: "system/templates/none.zip",
      packageSha256: "0".repeat(64),
      packageSize: 1,
      validation: { ok: true, rendered: true, checks: [], issues: [] },
    });
    // The agency's terms check for the image provider, kept to this client's own connection.
    await db.insert(aiConnections).values({
      scope: "client",
      scopeId: clientId,
      provider: "openrouter",
      encryptedKey: "test",
      keyHint: "…test",
      commercialUseStatus: "verified",
    });
    deps = {
      db,
      storage: new LocalDiskDriver({
        root: path.join(tmpdir(), `forgecy-refs-${suffix}`),
        baseUrl: "http://localhost:3000",
        secret: "test-secret-test-secret",
      }),
      ai: createAiGateway({
        ledger: createDbLedger(db),
        providers: { text: { anthropic: text }, image: { openrouter: image } },
        routing: {
          default: { primary: { provider: "anthropic", model: "fake-model" } },
          image: {
            primary: { provider: "openrouter", model: "google/gemini-3.1-flash-image-preview" },
          },
        },
      }),
      imageRoute: [{ provider: "openrouter", model: "google/gemini-3.1-flash-image-preview" }],
    };
    const anna = {
      type: "user" as const,
      id: userId,
      isAdmin: false,
      active: true,
      clients: [clientId],
    };
    const carousel = await createCarousel(db, anna, {
      clientId,
      params: {
        objective: "education",
        audienceIds: ["seg1"],
        channel: "instagram",
        format: "ig_4x5",
        templateKey,
        slideCount: 7,
      },
    });
    contentId = carousel.id;
    await db
      .update(contents)
      .set({ draft: { slides: [{ id: "s1", layout: "cover", slots: { title: "Cool" } }] } })
      .where(eq(contents.id, contentId));
  });

  afterAll(async () => {
    if (db && clientId) {
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.delete(templates).where(eq(templates.key, templateKey));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  it("sends no references, and no note, when the client has no usable site picture", async () => {
    await siteAsset({ status: "draft" });
    await siteAsset({ rights: null });
    const input = await run();
    expect(input.references).toBeUndefined();
    expect(input.prompt).toBe("A steel bottle on a rock at dawn");
  });

  it("sends the approved site pictures as references with the style note", async () => {
    await siteAsset();
    await siteAsset({ tags: ["scene", "site"] });
    const input = await run();
    expect(input.references).toHaveLength(2);
    expect(input.references!.every((r) => r.mimeType === "image/jpeg")).toBe(true);
    expect(input.prompt).toBe(`A steel bottle on a rock at dawn\n\n${IMAGE_REFERENCES_NOTE}`);
    expect(IMAGE_REFERENCES_NOTE).toMatch(
      /Match the visual style of the attached reference images/,
    );
  });

  it("keeps the pictures home when the Admin did not allow brand assets (external_restricted)", async () => {
    await db
      .update(clients)
      .set({
        aiPolicy: "external_restricted",
        approvedProviders: ["anthropic", "openrouter"],
        sendableAssets: ["brand_texts"],
      })
      .where(eq(clients.id, clientId));
    const without = await run();
    expect(without.references).toBeUndefined();
    expect(without.prompt).not.toContain(IMAGE_REFERENCES_NOTE);

    await db
      .update(clients)
      .set({ sendableAssets: ["brand_texts", "brand_assets"] })
      .where(eq(clients.id, clientId));
    const withRefs = await run();
    expect(withRefs.references).toHaveLength(2);
    expect(withRefs.prompt).toContain(IMAGE_REFERENCES_NOTE);
  });
});
