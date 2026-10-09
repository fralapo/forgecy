import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AiGateway } from "@forgecy/ai";
import type { Actor } from "@forgecy/core";
import {
  assets,
  brandIdentityProposals,
  brandSources,
  clients,
  createDb,
  eq,
  sql,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runSocialProfiles } from "../src/crawl";
import type { AnalystItem } from "../src/import/analyst";
import { runSourceImport } from "../src/import/run";
import { addSource, findOrCreateSocialSource, updateSourceStatus } from "../src/service";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const agent: Actor = { type: "agent", role: "brand_analyst" };
const memoryStorage = () => {
  const files = new Map<string, Uint8Array>();
  return {
    exists: async (k: string) => files.has(k),
    put: async (k: string, b: Uint8Array) => void files.set(k, b),
  } as unknown as StorageDriver;
};

const BIO = "Panificio artigianale a Napoli dal 1998";
const item = (over: Record<string, unknown>) =>
  ({
    locator: "Profile",
    quote: BIO,
    rationale: "From the bio",
    confidence: 0.8,
    ...over,
  }) as AnalystItem;

/** An analyst that answers the same items whatever it is asked, and records the prompts. */
const fakeAi = (items: AnalystItem[]) => {
  const seen: Array<{ system: string; input: string }> = [];
  const ai = {
    generateObject: async (req: { system: string; input: string }) => {
      seen.push({ system: req.system, input: req.input });
      return { data: { items }, provider: "openrouter", model: "fake/model" };
    },
  } as unknown as AiGateway;
  return { ai, seen };
};

describe.skipIf(!dbUrl)("social profiles (integration)", () => {
  let db: Database;
  let server: Server;
  let base: string;
  let png: Buffer;
  const clientIds: string[] = [];
  const suffix = Math.random().toString(36).slice(2, 8);

  const newClient = async () => {
    const [c] = await db
      .insert(clients)
      .values({ name: `Social ${suffix}`, slug: `social-${suffix}-${clientIds.length}` })
      .returning();
    clientIds.push(c!.id);
    return c!.id;
  };
  const ctx = () => ({ jobId: crypto.randomUUID(), attempt: 1, maxAttempts: 1 });
  const proposalsOf = async (clientId: string, sourceId: string) =>
    (
      await db
        .select()
        .from(brandIdentityProposals)
        .where(eq(brandIdentityProposals.clientId, clientId))
    ).filter((p) => p.evidence[0]?.sourceId === sourceId);

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    png = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#c33" } })
      .png()
      .toBuffer();
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      const html = (body: string, status = 200) => {
        res.writeHead(status, { "content-type": "text/html" });
        res.end(body);
      };
      if (path === "/robots.txt") return html("", 404);
      if (path === "/pic.png") {
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(png);
      }
      if (path.startsWith("/ok"))
        return html(
          `<head><meta property="og:title" content="Forno ${path}"><meta property="og:description" content="${BIO}"><meta property="og:image" content="/pic.png"></head>`,
        );
      if (path === "/wall") return html(`<title>Accedi o registrati</title>`);
      if (path === "/boom") return res.destroy();
      html("no", 404);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server?.close(r));
    for (const clientId of clientIds) {
      for (const table of [
        "brand_identity_proposals",
        "brand_identity_versions",
        "brand_identities",
        "brand_sources",
        "audit_events",
        "assets",
      ])
        await db.execute(sql`delete from ${sql.identifier(table)} where client_id = ${clientId}`);
      await db.delete(clients).where(eq(clients.id, clientId));
    }
    await db?.$client.end();
  });

  it("findOrCreateSocialSource gives one row per profile, however the address is written", async () => {
    const clientId = await newClient();
    const a = await findOrCreateSocialSource(db, agent, {
      clientId,
      kind: "instagram",
      url: "https://www.instagram.com/deodue",
    });
    const b = await findOrCreateSocialSource(db, agent, {
      clientId,
      kind: "instagram",
      url: "https://instagram.com/DeoDue/?hl=it",
    });
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, source: { id: a.source.id } });
    expect(a.source).toMatchObject({ kind: "instagram", status: "pending" });
    // Another platform is another source, and so is a removed one's replacement.
    const fb = await findOrCreateSocialSource(db, agent, {
      clientId,
      kind: "facebook",
      url: "https://www.facebook.com/deodue",
    });
    expect(fb.created).toBe(true);
    await db
      .update(brandSources)
      .set({ removedAt: new Date() })
      .where(eq(brandSources.id, a.source.id));
    const again = await findOrCreateSocialSource(db, agent, {
      clientId,
      kind: "instagram",
      url: "https://www.instagram.com/deodue",
    });
    expect(again.created).toBe(true);
  });

  it("imports each profile as its own source; a failing one does not stop the others", async () => {
    const clientId = await newClient();
    const { ai, seen } = fakeAi([
      item({ field: "positioning", text: "Il pane artigianale di Napoli" }),
      item({
        field: "mission",
        text: "Sfamare il mondo",
        quote: "Sfamare tutto il mondo ogni giorno",
      }),
    ]);
    const storage = memoryStorage();
    const results = await runSocialProfiles({ db, storage, ai }, ctx(), {
      clientId,
      allowPrivate: true,
      profiles: [
        { kind: "instagram", url: `${base}/ok1` },
        { kind: "facebook", url: `${base}/boom` },
        { kind: "linkedin", url: `${base}/wall` },
        { kind: "tiktok", url: `${base}/ok2` },
      ],
    });

    expect(results.map((r) => r.pages)).toEqual([1, 1]);
    const sources = await db.select().from(brandSources).where(eq(brandSources.clientId, clientId));
    const byKind = Object.fromEntries(sources.map((s) => [s.kind, s]));
    // Readable bios: extracted, gated proposals (the invented mission is gone), website prompt.
    for (const kind of ["instagram", "tiktok"]) {
      expect(byKind[kind]).toMatchObject({ status: "extracted" });
      expect(byKind[kind]!.pages?.[0]).toMatchObject({ locator: "Profile" });
      const mine = await proposalsOf(clientId, byKind[kind]!.id);
      expect(mine.map((p) => p.fieldPath)).toEqual(["/document/strategy/positioning"]);
    }
    expect(seen).toHaveLength(2);
    expect(seen[0]!.system).toContain('ONLY among the "Known colors"');
    // Unreadable ones: partial with the reason, nothing invented.
    expect(byKind.facebook).toMatchObject({ status: "partial", pages: [] });
    expect(byKind.facebook!.statusDetailRef?.map((r) => r.key)).toEqual([
      "brand.import.status.socialUnreachable",
    ]);
    expect(byKind.linkedin).toMatchObject({ status: "partial", pages: [] });
    expect(byKind.linkedin!.statusDetailRef?.map((r) => r.key)).toEqual([
      "brand.import.status.socialLoginWall",
    ]);
    expect(await proposalsOf(clientId, byKind.linkedin!.id)).toEqual([]);
    // The profile picture went to the library, tagged social, once.
    const saved = await db.select().from(assets).where(eq(assets.clientId, clientId));
    expect(saved).toHaveLength(1);
    expect(saved[0]!.tags).toEqual(["social"]);
  });

  it("does not read again a profile whose source already has its page", async () => {
    const clientId = await newClient();
    const { ai, seen } = fakeAi([item({ field: "positioning", text: "Il pane di Napoli" })]);
    const input = {
      clientId,
      allowPrivate: true,
      profiles: [{ kind: "instagram" as const, url: `${base}/ok1` }],
    };
    const deps = { db, storage: memoryStorage(), ai };
    expect(await runSocialProfiles(deps, ctx(), input)).toHaveLength(1);
    expect(await runSocialProfiles(deps, ctx(), input)).toHaveLength(0);
    expect(seen).toHaveLength(1);
  });

  describe("runSourceImport on a social source", () => {
    it("proposes from a readable bio only what the bio supports", async () => {
      const clientId = await newClient();
      const s = await addSource(db, agent, {
        clientId,
        kind: "instagram",
        title: "ig",
        url: `${base}/ok1`,
      });
      await updateSourceStatus(db, s.id, { pages: [{ locator: "Profile", text: BIO }] });
      const { ai } = fakeAi([
        item({ field: "positioning", text: "Il pane di Napoli" }),
        item({ field: "mission", text: "x", quote: "Fatturato da dieci milioni di euro" }),
        item({ field: "color", name: "Rosso", hex: "#FF0000", usage: "logo" }),
      ]);
      const result = await runSourceImport({ db, storage: memoryStorage(), ai }, ctx(), {
        clientId,
        sourceId: s.id,
      });
      expect(result).toMatchObject({ proposals: 1, discarded: 2 });
      expect((await proposalsOf(clientId, s.id)).map((p) => p.fieldPath)).toEqual([
        "/document/strategy/positioning",
      ]);
    });

    it("reads a profile link added by hand, and a login wall yields no proposal", async () => {
      vi.stubEnv("FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS", "true");
      const clientId = await newClient();
      const ok = await addSource(db, agent, {
        clientId,
        kind: "instagram",
        title: "ig",
        url: `${base}/ok1`,
        status: "extracted",
      });
      const wall = await addSource(db, agent, {
        clientId,
        kind: "facebook",
        title: "fb",
        url: `${base}/wall`,
        status: "extracted",
      });
      const { ai, seen } = fakeAi([item({ field: "positioning", text: "Il pane di Napoli" })]);
      const deps = { db, storage: memoryStorage(), ai };

      const walled = await runSourceImport(deps, ctx(), { clientId, sourceId: wall.id });
      expect(walled).toMatchObject({ pages: 0, proposals: 0, ai: "skipped" });
      const [wallRow] = await db.select().from(brandSources).where(eq(brandSources.id, wall.id));
      expect(wallRow).toMatchObject({ status: "partial" });
      expect(wallRow!.statusDetailRef?.[0]?.key).toBe("brand.import.status.socialLoginWall");
      expect(seen).toHaveLength(0);

      const done = await runSourceImport(deps, ctx(), { clientId, sourceId: ok.id });
      expect(done).toMatchObject({ pages: 1, proposals: 1 });
      const [okRow] = await db.select().from(brandSources).where(eq(brandSources.id, ok.id));
      expect(okRow!.pages?.[0]?.text).toContain(BIO);
    });
  });

  it("two sources imported in one run keep both sets; re-running one replaces only its own", async () => {
    const clientId = await newClient();
    const jobId = crypto.randomUUID();
    const mk = async (kind: "website" | "instagram", field: string) => {
      const s = await addSource(db, agent, { clientId, kind, title: kind });
      await updateSourceStatus(db, s.id, { pages: [{ locator: "Profile", text: BIO }] });
      const { ai } = fakeAi([item({ field, text: `${field} della panetteria` })]);
      const run = () =>
        runSourceImport(
          { db, storage: memoryStorage(), ai },
          { jobId, attempt: 1, maxAttempts: 1 },
          {
            clientId,
            sourceId: s.id,
          },
        );
      return { s, run };
    };
    const site = await mk("website", "positioning");
    const ig = await mk("instagram", "promise");
    await site.run();
    await ig.run();
    expect(await proposalsOf(clientId, site.s.id)).toHaveLength(1);
    expect(await proposalsOf(clientId, ig.s.id)).toHaveLength(1);
    const [before] = await proposalsOf(clientId, site.s.id);
    const [igBefore] = await proposalsOf(clientId, ig.s.id);

    // A retry of the same job for the profile replaces its own pending proposal, not the site's.
    await ig.run();
    const igAfter = await proposalsOf(clientId, ig.s.id);
    expect(igAfter).toHaveLength(1);
    expect(igAfter[0]!.id).not.toBe(igBefore!.id);
    const [siteAfter] = await proposalsOf(clientId, site.s.id);
    expect(siteAfter!.id).toBe(before!.id);
  });
});
