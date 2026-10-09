import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ProbeImage } from "@forgecy/audit";
import {
  and,
  assets,
  brandSources,
  clients,
  createDb,
  eq,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harvestImages } from "../src/import/images";
import { addSource } from "../src/service";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const png = (w: number, h: number, color: string) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .png()
    .toBuffer();
const noise = (w: number, h: number) =>
  sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">${inner}</svg>`;
const GIF_1X1 = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const memoryStorage = (failPut?: (bytes: Uint8Array) => boolean) => {
  const files = new Map<string, Uint8Array>();
  const storage = {
    exists: async (k: string) => files.has(k),
    put: async (k: string, b: Uint8Array) => {
      if (failPut?.(b)) throw new Error("disk full");
      files.set(k, b);
    },
  } as unknown as StorageDriver;
  return { storage, files };
};

describe.skipIf(!dbUrl)("harvestImages (integration)", () => {
  let db: Database;
  let server: Server;
  let base: string;
  let userId: string;
  const clientIds: string[] = [];
  const suffix = Math.random().toString(36).slice(2, 8);
  const routes = new Map<string, { type: string; body: Uint8Array | string }>();

  const img = (path: string, over: Partial<ProbeImage> = {}): ProbeImage => ({
    url: `${base}${path}`,
    alt: "",
    w: 800,
    h: 600,
    inHeader: false,
    inFooter: false,
    repeats: 1,
    source: "img",
    ...over,
  });

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const [u] = await db
      .insert(users)
      .values({ name: "bea", email: `bea-${suffix}@example.test` })
      .returning();
    userId = u!.id;
    routes.set("/photo.png", { type: "image/png", body: await noise(320, 240) });
    routes.set("/photo-copy.png", { type: "image/png", body: routes.get("/photo.png")!.body });
    routes.set("/pixel.gif", { type: "image/gif", body: GIF_1X1 });
    routes.set("/small.png", { type: "image/png", body: await png(150, 150, "#336699") });
    routes.set("/product.png", { type: "image/png", body: await png(400, 400, "#ffffff") });
    routes.set("/huge.png", {
      type: "image/png",
      body: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(9 * 1024 * 1024),
      ]),
    });
    routes.set("/evil.svg", {
      type: "image/svg+xml",
      body: svg("<script>alert(1)</script><rect width='9' height='9'/>"),
    });
    routes.set("/ok.svg", { type: "image/svg+xml", body: svg("<rect width='9' height='9'/>") });
    routes.set("/fake.png", { type: "text/html", body: "<html>not an image</html>" });
    routes.set("/lie.png", { type: "image/png", body: "<html>not an image</html>" });
    routes.set("/logo.svg", {
      type: "image/svg+xml",
      body: svg("<path d='M0 0h40v40z' fill='#123456'/>"),
    });
    routes.set("/logo-broken.png", { type: "image/png", body: "nope" });
    server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: `${base}/photo.png` }).end();
        return;
      }
      const route = routes.get(req.url ?? "");
      if (!route) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": route.type }).end(route.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (db) {
      for (const id of clientIds) {
        for (const table of ["brand_sources", "assets"])
          await db.execute(sql`delete from ${sql.identifier(table)} where client_id = ${id}`);
        await db.delete(clients).where(eq(clients.id, id));
      }
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  async function setup(failPut?: (bytes: Uint8Array) => boolean) {
    const n = clientIds.length;
    const [c] = await db
      .insert(clients)
      .values({ name: `Img ${suffix} ${n}`, slug: `brand-img-${suffix}-${n}` })
      .returning();
    clientIds.push(c!.id);
    const actor = {
      type: "user",
      id: userId,
      isAdmin: true,
      active: true,
      clients: "all",
    } as const;
    const site = await addSource(db, actor, {
      clientId: c!.id,
      kind: "website",
      title: "Site",
      url: `${base}/`,
    });
    return { clientId: c!.id, sourceId: site.id, ...memoryStorage(failPut) };
  }

  const rows = (clientId: string) => db.select().from(assets).where(eq(assets.clientId, clientId));

  it("saves site images with source, tags and rights, and skips what it must", async () => {
    const t = await setup();
    const result = await harvestImages(
      { db, storage: t.storage },
      {
        clientId: t.clientId,
        sourceId: t.sourceId,
        requestedBy: userId,
        allowPrivate: true,
        images: [
          img("/photo.png", { alt: "Il negozio" }),
          img("/photo-copy.png"),
          img("/pixel.gif"),
          img("/small.png"),
          img("/product.png"),
          img("/huge.png"),
          img("/evil.svg"),
          img("/fake.png"),
          img("/lie.png"),
          img("/ok.svg"),
          img("/missing.png"),
        ],
      },
    );
    const saved = await rows(t.clientId);
    expect(saved.map((r) => r.mime).sort()).toEqual(["image/png", "image/png", "image/svg+xml"]);
    expect(result).toMatchObject({ saved: 3, skipped: 8 });

    const photo = saved.find((r) => r.alt === "Il negozio")!;
    expect(photo).toMatchObject({
      source: "site",
      status: "approved",
      width: 320,
      height: 240,
      tags: ["scene", "site"],
      createdBy: userId,
      decidedBy: userId,
    });
    expect(photo.storageKey).toBe(`clients/${t.clientId}/assets/${photo.sha256}.png`);
    expect(t.files.has(photo.storageKey)).toBe(true);
    expect(photo.rights).toMatchObject({
      basis: "client_supplied",
      confirmedBy: userId,
      note: `Imported from the client's website: ${base}/`,
    });
    expect(saved.find((r) => r.mime === "image/svg+xml")).toMatchObject({
      tags: ["graphic", "site"],
      width: 120,
    });
    expect(saved.find((r) => r.width === 400)?.tags).toEqual(["product", "site"]);
  });

  it("leaves rights empty and the image a draft when nobody started the import", async () => {
    const t = await setup();
    await harvestImages(
      { db, storage: t.storage },
      {
        clientId: t.clientId,
        sourceId: t.sourceId,
        allowPrivate: true,
        images: [img("/photo.png")],
      },
    );
    const [row] = await rows(t.clientId);
    expect(row).toMatchObject({ status: "draft", rights: null, createdBy: null, decidedBy: null });
  });

  it("refuses a private address when private hosts are not allowed", async () => {
    const t = await setup();
    const result = await harvestImages(
      { db, storage: t.storage },
      {
        clientId: t.clientId,
        sourceId: t.sourceId,
        allowPrivate: false,
        images: [img("/photo.png")],
        logos: [img("/logo.svg")],
      },
    );
    expect(result).toEqual({ saved: 0, skipped: 1, failed: 0 });
    expect(await rows(t.clientId)).toEqual([]);
  });

  it("refuses a redirect to a refused host, credentials in the url, and data: or file: urls", async () => {
    const t = await setup();
    const checked: string[] = [];
    const result = await harvestImages(
      { db, storage: t.storage },
      {
        clientId: t.clientId,
        sourceId: t.sourceId,
        allowPrivate: true,
        // The first hop passes, the place it redirects to does not.
        hostCheck: async (url) => {
          checked.push(url);
          return !url.endsWith("/photo.png");
        },
        images: [
          img("/redirect"),
          {
            ...img("/photo.png"),
            url: base.replace("http://", "http://user:secret@") + "/photo.png",
          },
          { ...img("/photo.png"), url: "data:image/png;base64,iVBORw0KGgo=" },
          { ...img("/photo.png"), url: "file:///etc/passwd" },
        ],
      },
    );
    expect(result).toMatchObject({ saved: 0, skipped: 4, failed: 0 });
    expect(checked).toEqual([`${base}/redirect`, `${base}/photo.png`]);
    expect(await rows(t.clientId)).toEqual([]);
  });

  it("still harvests, unattributed, when the requester no longer exists", async () => {
    const t = await setup();
    const result = await harvestImages(
      { db, storage: t.storage },
      {
        clientId: t.clientId,
        sourceId: t.sourceId,
        requestedBy: crypto.randomUUID(),
        allowPrivate: true,
        images: [img("/photo.png")],
        logos: [img("/logo.svg")],
      },
    );
    expect(result).toMatchObject({ saved: 2, failed: 0 });
    expect(result.logo).toBeDefined();
    for (const row of await rows(t.clientId))
      expect(row).toMatchObject({
        status: "draft",
        rights: null,
        createdBy: null,
        decidedBy: null,
      });
  });

  it("a failure on one file loses neither the logo nor the other images", async () => {
    const product = routes.get("/product.png")!.body as Uint8Array;
    const t = await setup(
      (bytes) => Buffer.compare(Buffer.from(bytes), Buffer.from(product)) === 0,
    );
    const result = await harvestImages(
      { db, storage: t.storage },
      {
        clientId: t.clientId,
        sourceId: t.sourceId,
        requestedBy: userId,
        allowPrivate: true,
        images: [img("/photo.png"), img("/product.png"), img("/ok.svg")],
        logos: [img("/logo.svg")],
      },
    );
    expect(result).toMatchObject({ saved: 3, skipped: 1, failed: 1 });
    expect(result.logo?.image.url).toBe(`${base}/logo.svg`);
    expect((await rows(t.clientId)).map((r) => r.tags[0]).sort()).toEqual([
      "graphic",
      "logo",
      "scene",
    ]);
  });

  it("keeps the existing row when the same file is harvested again", async () => {
    const t = await setup();
    const input = {
      clientId: t.clientId,
      sourceId: t.sourceId,
      allowPrivate: true,
      images: [img("/photo.png")],
    };
    expect(await harvestImages({ db, storage: t.storage }, input)).toMatchObject({ saved: 1 });
    expect(await harvestImages({ db, storage: t.storage }, input)).toMatchObject({
      saved: 0,
      skipped: 1,
    });
    expect(await rows(t.clientId)).toHaveLength(1);
  });

  it("stops at the image limit, and the logo does not count toward it", async () => {
    const t = await setup();
    const result = await harvestImages(
      { db, storage: t.storage },
      {
        clientId: t.clientId,
        sourceId: t.sourceId,
        allowPrivate: true,
        max: 1,
        images: [img("/photo.png"), img("/product.png")],
        logos: [img("/logo.svg")],
      },
    );
    expect(result.saved).toBe(2);
    expect((await rows(t.clientId)).map((r) => r.tags[0]).sort()).toEqual(["logo", "scene"]);
  });

  it("registers the first logo that validates as an asset and as a brand source, once", async () => {
    const t = await setup();
    const input = {
      clientId: t.clientId,
      sourceId: t.sourceId,
      requestedBy: userId,
      allowPrivate: true,
      images: [],
      logos: [img("/logo-broken.png", { alt: "logo" }), img("/logo.svg", { alt: "logo" })],
    };
    const first = await harvestImages({ db, storage: t.storage }, input);
    expect(first.logo?.image.url).toBe(`${base}/logo.svg`);

    const [asset] = await rows(t.clientId);
    expect(asset).toMatchObject({ tags: ["logo", "site"], mime: "image/svg+xml" });

    const logoSources = await db
      .select()
      .from(brandSources)
      .where(and(eq(brandSources.clientId, t.clientId), eq(brandSources.sha256, asset!.sha256)));
    expect(logoSources).toHaveLength(1);
    expect(logoSources[0]).toMatchObject({
      id: first.logo?.sourceId,
      clientId: t.clientId,
      kind: "screenshot",
      title: "Logo 127.0.0.1",
      mime: "image/svg+xml",
      storageKey: `clients/${t.clientId}/brand-sources/${asset!.sha256}.svg`,
    });
    expect(t.files.has(logoSources[0]!.storageKey!)).toBe(true);

    const second = await harvestImages({ db, storage: t.storage }, input);
    expect(second.logo?.sourceId).toBe(first.logo?.sourceId);
    expect(await rows(t.clientId)).toHaveLength(1);
  });
});
