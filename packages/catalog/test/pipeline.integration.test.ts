import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  createAiGateway,
  createFakeTextProvider,
  createMemoryLedger,
  type TextGenerationRequest,
} from "@forgecy/ai";
import { PermissionDeniedError, type Actor } from "@forgecy/core";
import {
  clients,
  createDb,
  eq,
  inArray,
  jobs,
  productFieldProposals,
  productImages,
  productImportFiles,
  productImportItems,
  productImports,
  products,
  users,
  type Database,
} from "@forgecy/db";
import { LocalDiskDriver } from "@forgecy/files";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptItemSensitive,
  addUploadedFile,
  approveItems,
  closeReview,
  confirmMapping,
  createProduct,
  decideFieldProposal,
  decideImage,
  decideItem,
  itemTab,
  openDraftImport,
  runImportPhase,
  spoolToTemp,
  startImport,
  transitionProducts,
  updateProductFields,
  type ActingUser,
  type ColumnMapping,
  type EnqueueImportStep,
  type MappingProposalData,
  type PipelineDeps,
} from "../src";
import { makePdf, makeZip, png } from "./fixtures";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const CSV = [
  "ID,Type,SKU,Name,Published,Visibility in catalog,Short description,Description,Tax status,In stock?,Regular price,Categories,Images,Parent",
  '1,simple,RS-CV-050,Face cream 50 ml,1,visible,"<p>Light moisturizing cream</p>",Fresh texture,taxable,1,"19,90",Face > Creams,RS-CV-050.jpg,',
  "2,simple,RS-SN-030,Night serum,1,visible,Regenerating serum,,taxable,1,,Face,,",
  "3,simple,RS-XX-001,,1,visible,No name,,taxable,1,,Face,,",
  "4,simple,RS-BS-100,Solid balm,1,visible,100% recyclable,,taxable,1,,Body,,",
].join("\n");

describe.skipIf(!dbUrl)("catalog import (integration)", () => {
  let db: Database;
  let mediaRoot: string;
  let storage: LocalDiskDriver;
  let user: ActingUser;
  let clientId: string;
  let noAiClientId: string;
  const aiCalls: TextGenerationRequest[] = [];

  const enqueue: EnqueueImportStep = async (input) => {
    const [row] = await db
      .insert(jobs)
      .values({ kind: "catalog.import_analyze", payload: input, clientId: input.clientId })
      .returning({ id: jobs.id });
    return row!.id;
  };

  function deps(withAi = true): PipelineDeps {
    const provider = createFakeTextProvider("anthropic");
    for (let i = 0; i < 20; i++)
      provider.push((req) => {
        aiCalls.push(req);
        const json = req.system.includes("Extract the products")
          ? {
              products: [
                {
                  name: "Body oil",
                  sku: "RS-OC-100",
                  category: "Body",
                  shortDescription: "Nourishing oil, dermatologically tested",
                  longDescription: null,
                  materials: ["Almond oil"],
                  formats: ["100 ml"],
                  usage: [],
                  features: [],
                  benefits: [],
                  price: null,
                  currency: null,
                  availability: null,
                  fieldPages: [{ field: "name", page: 2 }],
                  claims: [{ field: "shortDescription", kind: "health" }],
                  confidence: "medium",
                },
              ],
              skippedPages: [{ page: 3, reason: "unreadable table" }],
            }
          : req.system.includes("Match the image file names")
            ? { suggestions: [{ image: 0, product: 0, confidence: "low" }] }
            : { columns: [] };
        return {
          text: JSON.stringify(json),
          parsed: json,
          usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end",
          model: "claude-sonnet-5-5",
        };
      });
    return {
      db,
      storage,
      ai: withAi
        ? createAiGateway({
            ledger: createMemoryLedger(),
            providers: { text: { anthropic: provider }, image: {} },
            routing: {
              default: { primary: { provider: "anthropic", model: "claude-sonnet-5-5" } },
            },
          })
        : null,
      localModelConfigured: false,
      catalogAiEnabled: true,
    };
  }

  async function upload(
    importId: string,
    cid: string,
    name: string,
    data: Buffer,
    catalogAiAvailable = true,
  ) {
    const temp = await spoolToTemp(Readable.from([data]), 300 * 1024 * 1024);
    try {
      return await addUploadedFile(db, storage, user, {
        clientId: cid,
        importId,
        relativePath: name,
        temp,
        catalogAiAvailable,
      });
    } finally {
      await temp.cleanup();
    }
  }

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    mediaRoot = await mkdtemp(path.join(tmpdir(), "forgecy-catalog-test-"));
    storage = new LocalDiskDriver({
      root: mediaRoot,
      baseUrl: "http://localhost:3000",
      secret: "test-secret-at-least-16",
    });
    const suffix = Math.random().toString(36).slice(2, 8);
    const [u] = await db
      .insert(users)
      .values({ name: "Laura", email: `laura-${suffix}@example.com` })
      .returning();
    user = {
      id: u!.id,
      name: "Laura",
      actor: { type: "user", id: u!.id, isAdmin: false, active: true },
    };
    const [c] = await db
      .insert(clients)
      .values({ name: "Rossi Srl", slug: `rossi-${suffix}`, status: "active" })
      .returning();
    const [n] = await db
      .insert(clients)
      .values({ name: "Bianchi", slug: `bianchi-${suffix}`, status: "active", aiPolicy: "no_ai" })
      .returning();
    clientId = c!.id;
    noAiClientId = n!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.delete(clients).where(inArray(clients.id, [clientId, noAiClientId].filter(Boolean)));
      if (user) await db.delete(users).where(eq(users.id, user.id));
      await db.$client.end();
    }
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it("imports mixed files, stops for mapping, then proposes products for review", async () => {
    // An approved product already in the catalog: the CSV row with the same SKU is a conflict.
    const existing = await createProduct(db, user, {
      clientId,
      name: "Face cream 50 ml",
      sku: "RS-CV-050",
      category: "Creams",
    });
    await updateProductFields(db, user, {
      clientId,
      productId: existing.id,
      revision: existing.revision,
      patch: { shortDescription: "Moisturizing cream" },
    });
    const done = await transitionProducts(db, user, {
      clientId,
      ids: [existing.id],
      action: "approve",
    });
    expect(done.done).toEqual([existing.id]);

    const imp = await openDraftImport(db, user, clientId);
    const csv = await upload(imp.id, clientId, "products.csv", Buffer.from(CSV));
    expect(csv).toMatchObject({
      kind: "sheet",
      route: "map",
      valid: true,
      message: "Valid · 4 rows",
    });
    expect((csv.mappingProposal as unknown as MappingProposalData).preset).toBe("woocommerce");
    const pdf = await upload(
      imp.id,
      clientId,
      "Price_list_2026.pdf",
      makePdf(["Price list 2026", "Body oil RS-OC-100", "Table"]),
    );
    expect(pdf).toMatchObject({ kind: "pdf", route: "extract" });
    const zip = await upload(
      imp.id,
      clientId,
      "photos.zip",
      await makeZip([
        { path: "RS-CV-050.jpg", data: png(1) },
        { path: "products/Shower gel/1.png", data: png(2) },
        {
          path: "products/Shower gel/sheet.txt",
          data: "Name: Shower gel\nCategory: Body\nShort description: Gentle gel",
        },
        { path: "products/IMG_0231.png", data: png(3) },
        { path: "program.exe", data: "MZ" },
      ]),
    );
    expect(zip.message).toContain("ZIP:");
    const rar = await upload(imp.id, clientId, "catalog.rar", Buffer.from("Rar!\u001a\u0007"));
    expect(rar).toMatchObject({ valid: false, errorCode: "IMPORT-INVALID" });

    await startImport(db, enqueue, user, {
      clientId,
      importId: imp.id,
      aiAvailable: true,
      catalogAiAvailable: true,
    });
    const scan = await runImportPhase(deps(), imp.id, "scan");
    expect(scan).toEqual({ status: "needs_mapping" });
    const children = await db
      .select()
      .from(productImportFiles)
      .where(eq(productImportFiles.parentId, zip.id));
    expect(children.map((c) => c.path).sort()).toEqual([
      "RS-CV-050.jpg",
      "products/IMG_0231.png",
      "products/Shower gel/1.png",
      "products/Shower gel/sheet.txt",
    ]);

    const proposal = csv.mappingProposal as unknown as MappingProposalData;
    const mapping: ColumnMapping = { columns: proposal.columns, preset: "woocommerce" };
    await expect(
      confirmMapping(db, enqueue, user, {
        clientId,
        importId: imp.id,
        fileId: csv.id,
        mapping: { columns: mapping.columns.map(() => "ignore") },
      }),
    ).rejects.toThrow(/product name/);
    const resumed = await confirmMapping(db, enqueue, user, {
      clientId,
      importId: imp.id,
      fileId: csv.id,
      mapping,
      saveAs: "WooCommerce export",
    });
    expect(resumed.resumed).toBe(true);

    const result = await runImportPhase(deps(), imp.id, "extract");
    expect(result).toMatchObject({ conflicts: 1 });
    const [after] = await db.select().from(productImports).where(eq(productImports.id, imp.id));
    expect(after!.status).toBe("ready_for_review");

    const items = await db
      .select()
      .from(productImportItems)
      .where(eq(productImportItems.importId, imp.id));
    const byName = (n: string) => items.find((i) => (i.draft as { name?: string }).name === n)!;
    // CSV row without name, PDF page not readable: discarded with reason.
    expect(
      items
        .filter((i) => i.status === "discarded")
        .map((i) => i.discardReason)
        .sort(),
    ).toEqual(["Page 3: unreadable table", "Row 4: missing name"]);
    // …and a reference, so the review shows the reason in the reader's language.
    expect(
      items
        .filter((i) => i.status === "discarded")
        .map((i) => i.discardRef?.key)
        .sort(),
    ).toEqual(["products.discards.page", "products.discards.rowNoName"]);
    // Conflict with the approved value, never resolved automatically.
    const crema = byName("Face cream 50 ml");
    expect(itemTab(crema)).toBe("conflicts");
    expect(crema.conflicts).toEqual([
      {
        field: "shortDescription",
        approved: "Moisturizing cream",
        incoming: "Light moisturizing cream",
      },
    ]);
    expect((crema.draft as { price?: string }).price).toBe("19.90");
    expect(crema.images).toEqual([
      {
        fileId: children.find((c) => c.path === "RS-CV-050.jpg")!.id,
        method: "sheet",
        confidence: "high",
      },
    ]);
    // PDF product proposed by the Brand Analyst, with page and claim.
    const olio = byName("Body oil");
    expect(olio.proposedByAgent).toBe(true);
    expect(olio.sensitive).toBe(true);
    expect(
      (olio.fieldMeta as Record<string, { source: { page?: number } }>).name!.source.page,
    ).toBe(2);
    // Folder with a text file → one product with its photo.
    const gel = byName("Shower gel");
    expect(gel.images).toHaveLength(1);
    // Unassigned image with an AI suggestion; the PDF text sent to the AI is wrapped as data.
    const loose = (
      await db.select().from(productImportFiles).where(eq(productImportFiles.importId, imp.id))
    ).find((f) => f.path === "products/IMG_0231.png")!;
    expect(loose.imageState).toBe("unassigned");
    expect(loose.suggestion).toMatchObject({ confidence: "low" });
    const pdfCall = aiCalls.find((c) => c.system.includes("Extract the products"))!;
    expect(pdfCall.messages[0]!.content).toContain("<document>");
    expect(pdfCall.system).toContain("DATA ONLY");

    // Review: bulk approval excludes sensitive items and says so.
    const siero = byName("Night serum");
    const balsamo = byName("Solid balm");
    const bulk = await approveItems(db, user, {
      clientId,
      importId: imp.id,
      itemIds: [siero.id, balsamo.id, olio.id],
    });
    expect(bulk.approved).toBe(1);
    expect(bulk.excluded.map((e) => e.reason)).toEqual([
      "sensitive fields to accept one by one",
      "sensitive fields to accept one by one",
    ]);
    await acceptItemSensitive(db, user, {
      clientId,
      importId: imp.id,
      itemId: balsamo.id,
      field: "shortDescription",
    });
    const ok = await approveItems(db, user, { clientId, importId: imp.id, itemIds: [balsamo.id] });
    expect(ok.approved).toBe(1);

    // AI agents can never approve (server side).
    const agent: Actor = { type: "agent", role: "brand_analyst" };
    await expect(
      decideItem(
        db,
        { ...user, actor: agent },
        { clientId, importId: imp.id, itemId: gel.id, action: { type: "approve" } },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // Conflict: keep the approved description; nothing changes silently.
    await decideItem(db, user, {
      clientId,
      importId: imp.id,
      itemId: crema.id,
      action: { type: "conflict", field: "shortDescription", decision: "defer" },
    });
    const [stillApproved] = await db.select().from(products).where(eq(products.id, existing.id));
    expect(stillApproved!.status).toBe("approved");
    expect((stillApproved!.details as { shortDescription: string }).shortDescription).toBe(
      "Moisturizing cream",
    );
    const [open] = await db
      .select()
      .from(productFieldProposals)
      .where(eq(productFieldProposals.productId, existing.id));
    expect(open!.proposedValue).toBe("Light moisturizing cream");
    await decideFieldProposal(db, user, { clientId, proposalId: open!.id, decision: "accept" });

    // Close is blocked while duplicates or conflicts remain open.
    const pendingConflicts = (
      await db.select().from(productImportItems).where(eq(productImportItems.importId, imp.id))
    ).filter((i) => i.status === "pending" && i.matchProductId);
    for (const i of pendingConflicts)
      for (const c of i.conflicts as Array<{ field: string }>)
        await decideItem(db, user, {
          clientId,
          importId: imp.id,
          itemId: i.id,
          action: { type: "conflict", field: c.field as "category", decision: "keep" },
        });

    await decideImage(db, user, {
      clientId,
      importId: imp.id,
      fileId: loose.id,
      action: "accept_suggestion",
    });
    const closed = await closeReview(db, user, { clientId, importId: imp.id });
    expect(closed.status).toBe("partial"); // discarded rows remain
    const catalog = await db.select().from(products).where(eq(products.clientId, clientId));
    expect(catalog.map((p) => `${p.name}:${p.status}`).sort()).toEqual([
      "Body oil:proposed",
      "Face cream 50 ml:approved",
      "Night serum:approved",
      "Shower gel:proposed",
      "Solid balm:approved",
    ]);
    const olioProduct = catalog.find((p) => p.name === "Body oil")!;
    expect(olioProduct.proposedByAgent).toBe(true);
    const crema2 = catalog.find((p) => p.name === "Face cream 50 ml")!;
    expect((crema2.details as { shortDescription: string }).shortDescription).toBe(
      "Light moisturizing cream",
    );
    const imgs = await db.select().from(productImages).where(eq(productImages.clientId, clientId));
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    expect(imgs.every((i) => i.status === "draft")).toBe(true);

    // Stale revision → conflict, never overwrite.
    await expect(
      updateProductFields(db, user, {
        clientId,
        productId: crema2.id,
        revision: crema2.revision - 1,
        patch: { notes: "x" },
      }),
    ).rejects.toThrow(/someone else/i);
  });

  it("with no_ai keeps PDFs as sources and never calls a provider", async () => {
    const before = aiCalls.length;
    const imp = await openDraftImport(db, user, noAiClientId);
    const pdf = await upload(imp.id, noAiClientId, "price-list.pdf", makePdf(["Product A"]), false);
    expect(pdf.route).toBe("source");
    const txt = await upload(
      imp.id,
      noAiClientId,
      "Product B.txt",
      Buffer.from("Name: Product B\nCategory: Home"),
      false,
    );
    expect(txt.route).toBe("match");
    await startImport(db, enqueue, user, {
      clientId: noAiClientId,
      importId: imp.id,
      aiAvailable: false,
      catalogAiAvailable: false,
    });
    await runImportPhase(deps(), imp.id, "scan");
    const items = await db
      .select()
      .from(productImportItems)
      .where(eq(productImportItems.importId, imp.id));
    expect(items.map((i) => (i.draft as { name: string }).name)).toEqual(["Product B"]);
    expect(aiCalls.length).toBe(before);
  });
});
