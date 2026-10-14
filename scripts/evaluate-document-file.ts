import { loadEnvConfig } from "@next/env";
import Database from "better-sqlite3";
import { readFileSync, statSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

loadEnvConfig(process.cwd());

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const argumentsFor = (name: string) => process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []);

async function main() {
  if (!process.argv.includes("--live") || !process.argv.includes("--allow-external-processing")) {
    throw new Error("Questo comando invia il PDF a OpenRouter. Specifica --live --allow-external-processing e --input-pdf <percorso>.");
  }
  const inputPath = argument("--input-pdf");
  if (!inputPath) throw new Error("Specifica --input-pdf <percorso>.");
  const pdfPath = resolve(inputPath);
  const inputStat = statSync(pdfPath);
  if (!inputStat.isFile() || inputStat.size < 1 || inputStat.size > 10_000_000 || !pdfPath.toLowerCase().endsWith(".pdf")) {
    throw new Error("Il PDF deve essere un file esistente di dimensione compresa tra 1 byte e 10 MB.");
  }
  const bytes = new Uint8Array(readFileSync(pdfPath));
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Il file selezionato non ha una firma PDF valida.");

  const originalDataDirectory = (await import("../lib/local-db")).getLocalDataDirectory();
  const originalDb = new Database(join(originalDataDirectory, "forgecy.sqlite"), { readonly: true, fileMustExist: true });
  let preferences: { text_model: string | null; ocr_model: string | null };
  try { preferences = originalDb.prepare("SELECT text_model,ocr_model FROM ai_preferences LIMIT 1").get() as typeof preferences || { text_model: null, ocr_model: null }; }
  finally { originalDb.close(); }

  const { getOpenRouterApiKey } = await import("../lib/openrouter-credentials");
  let apiKey = await getOpenRouterApiKey();
  if (!apiKey) throw new Error("La chiave OpenRouter locale non è configurata.");
  const previousDataDirectory = process.env.FORGECY_DATA_DIR;
  const previousApiKey = process.env.OPENROUTER_API_KEY;
  const previousTextModel = process.env.OPENROUTER_MODEL;
  const isolatedDirectory = mkdtempSync(join(tmpdir(), "forgecy-live-file-eval-"));
  const keepImageEvidence = process.argv.includes("--keep-image-evidence");
  const evidenceDirectory = keepImageEvidence ? mkdtempSync(join(tmpdir(), "forgecy-file-eval-images-")) : null;
  let db: ReturnType<(typeof import("../lib/local-db"))["localDb"]> | undefined;
  try {
    process.env.FORGECY_DATA_DIR = isolatedDirectory;
    process.env.OPENROUTER_API_KEY = apiKey;
    if (preferences.text_model) process.env.OPENROUTER_MODEL = preferences.text_model;
    const { localDb, LOCAL_OWNER_ID } = await import("../lib/local-db");
    db = localDb();
    const client = await db.from("clients").insert({ owner_id: LOCAL_OWNER_ID, name: "Forgecy External Document Evaluation", industry: "Evaluation", profile: {} }).select("id").single();
    if (client.error || !client.data) throw new Error("Impossibile creare il workspace temporaneo di valutazione.");
    const clientId = String(client.data.id);
    const expectedName = argument("--seed-existing-name");
    const expectedText = argumentsFor("--expect-text");
    const expectedRows = argumentsFor("--expect-row");
    let expectedOfferId: string | null = null;
    if (expectedName) {
      const offer = await db.from("offers").insert({
        client_id: clientId, kind: "product", name: expectedName.slice(0, 180),
        description: "Descrizione iniziale di test", price: null, currency: "EUR", status: "verified",
      }).select("id").single();
      if (offer.error || !offer.data) throw new Error("Impossibile preparare il prodotto atteso.");
      expectedOfferId = String(offer.data.id);
    }
    const textModel = preferences.text_model || process.env.OPENROUTER_MODEL || "~deepseek/deepseek-flash-latest";
    const ocrModel = preferences.ocr_model || "deepseek/deepseek-v4.1-flash";
    db.connection.prepare(`INSERT INTO ai_preferences(owner_id,text_model,ocr_model,semantic_enabled,updated_at)
      VALUES(?,?,?,1,?) ON CONFLICT(owner_id) DO UPDATE SET
      text_model=excluded.text_model,ocr_model=excluded.ocr_model,updated_at=excluded.updated_at`)
      .run(LOCAL_OWNER_ID, textModel, ocrModel, new Date().toISOString());

    const form = new FormData();
    form.append("file", new File([bytes], basename(pdfPath).slice(0, 120), { type: "application/pdf" }));
    const { POST } = await import("../app/api/workspace/[...parts]/route");
    const uploadStartedAt = performance.now();
    const response = await POST(new Request(`http://localhost/api/workspace/clients/${clientId}/upload`, { method: "POST", body: form }), {
      params: Promise.resolve({ parts: ["clients", clientId, "upload"] }),
    });
    const pipelineElapsedMs = Math.round(performance.now() - uploadStartedAt);
    const payload = await response.json() as {
      error?: string; extracted?: boolean; source?: { id?: string; body?: string; source_metadata?: { document_processing?: { method?: string; page_count?: number } } };
      catalog?: { status?: string; added?: number; updated?: number; skippedManual?: number; invalid?: number };
    };
    if (!response.ok) throw new Error(payload.error || `Upload di valutazione fallito (HTTP ${response.status}).`);
    const offers = await db.from("offers").select("id,source_id,image_source_id").eq("client_id", clientId).eq("kind", "product");
    if (offers.error) throw new Error("Impossibile verificare i prodotti importati.");
    const expectedOffer = expectedOfferId ? offers.data?.find((offer: Record<string, unknown>) => offer.id === expectedOfferId) as Record<string, unknown> | undefined : undefined;
    const sources = await db.from("sources").select("id,title,source_metadata,file_path").eq("client_id", clientId);
    if (sources.error) throw new Error("Impossibile verificare le immagini estratte.");
    const productImages = (sources.data || []).filter((source: Record<string, unknown>) =>
      (source.source_metadata as Record<string, unknown> | undefined)?.asset_role === "product" && typeof source.file_path === "string");
    const linkedProductImages = new Set((offers.data || []).map((offer: Record<string, unknown>) => offer.image_source_id).filter(Boolean));
    let retainedSeedImage: string | null = null;
    const retainedImages: string[] = [];
    if (evidenceDirectory) {
      for (let index = 0; index < productImages.length; index++) {
        const image = productImages[index] as Record<string, unknown>;
        const downloaded = await db.storage.from("forgecy-assets").download(String(image.file_path));
        if (downloaded.error || !downloaded.data) throw new Error("Impossibile conservare l’immagine collegata per la verifica visiva.");
        const metadata = image.source_metadata as Record<string, unknown>;
        const extension = metadata.content_type === "image/jpeg" ? "jpg" : metadata.content_type === "image/webp" ? "webp" : "png";
        const imageIndex = /\((\d+)\)$/.exec(String(image.title || ""))?.[1] || String(index + 1);
        const retainedPath = join(evidenceDirectory, `catalog-image-${imageIndex}.${extension}`);
        writeFileSync(retainedPath, Buffer.from(await downloaded.data.arrayBuffer()), { flag: "wx" });
        retainedImages.push(retainedPath);
        if (expectedOffer?.image_source_id === image.id) retainedSeedImage = retainedPath;
      }
    }
    const imageAssignments = (offers.data || []).map((offer: Record<string, unknown>, index: number) => {
      const linked = productImages.find((image: Record<string, unknown>) => image.id === offer.image_source_id);
      return {
        productRecord: index + 1,
        seededProduct: offer.id === expectedOfferId,
        linked: Boolean(linked),
        imageIndex: linked ? Number(/\((\d+)\)$/.exec(String(linked.title || ""))?.[1] || 0) || null : null,
      };
    });
    const usage = db.connection.prepare("SELECT count(*) requests,sum(reported_cost_usd) reported_cost_usd FROM ai_provider_usage WHERE client_id=?").get(clientId) as { requests: number; reported_cost_usd: number | null };
    console.log(JSON.stringify({
      isolatedWorkspace: true,
      inputFile: "provided-pdf",
      inputBytes: bytes.byteLength,
      extracted: payload.extracted === true,
      ocrMethod: payload.source?.source_metadata?.document_processing?.method || null,
      ocrPages: payload.source?.source_metadata?.document_processing?.page_count || null,
      pipelineElapsedMs,
      expectedTextMarkersFound: expectedText.filter(marker => (payload.source?.body || "").replace(/\s+/g, " ").toLocaleLowerCase("it").includes(marker.replace(/\s+/g, " ").toLocaleLowerCase("it"))).length,
      expectedTextMarkerCount: expectedText.length,
      expectedTableRowsFound: expectedRows.filter(row => (payload.source?.body || "").replace(/\s+/g, "").toLocaleLowerCase("it").includes(row.replace(/\s+/g, "").toLocaleLowerCase("it"))).length,
      expectedTableRowCount: expectedRows.length,
      catalog: payload.catalog || null,
      productRows: offers.data?.length || 0,
      visualProductAssets: productImages.length,
      offersLinkedToVisualAssets: linkedProductImages.size,
      imageAssignments,
      seededProductMatched: expectedOffer ? expectedOffer.source_id === payload.source?.id : null,
      seededProductImageLinked: expectedOffer ? Boolean(expectedOffer.image_source_id && productImages.some((image: Record<string, unknown>) => image.id === expectedOffer.image_source_id)) : null,
      retainedSeedImagePath: retainedSeedImage,
      retainedImageEvidencePaths: retainedImages,
      providerRequestsRecorded: usage.requests,
      reportedCostUsd: usage.reported_cost_usd,
      userWorkspaceModified: false,
      credentialPrintedOrWritten: false,
    }, null, 2));
    if (payload.catalog?.status !== "processed") process.exitCode = 1;
  } finally {
    db?.connection.close();
    delete (globalThis as typeof globalThis & { __forgecyLocalDb?: unknown }).__forgecyLocalDb;
    if (previousDataDirectory === undefined) delete process.env.FORGECY_DATA_DIR; else process.env.FORGECY_DATA_DIR = previousDataDirectory;
    if (previousApiKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousApiKey;
    if (previousTextModel === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = previousTextModel;
    apiKey = "";
    rmSync(isolatedDirectory, { recursive: true, force: true });
  }
}

void main().catch(error => {
  console.error("Live file evaluation failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
