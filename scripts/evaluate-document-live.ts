import { loadEnvConfig } from "@next/env";
import Database from "better-sqlite3";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

loadEnvConfig(process.cwd());

async function main() {
  if (!process.argv.includes("--live")) throw new Error("Per inviare il documento sintetico a OpenRouter, esegui con --live.");

  const originalDataDirectory = (await import("../lib/local-db")).getLocalDataDirectory();
  const originalDb = new Database(join(originalDataDirectory, "forgecy.sqlite"), { readonly: true, fileMustExist: true });
  let preferences: { text_model: string | null; ocr_model: string | null };
  try {
    preferences = originalDb.prepare("SELECT text_model,ocr_model FROM ai_preferences LIMIT 1").get() as typeof preferences || { text_model: null, ocr_model: null };
  } finally { originalDb.close(); }

  const { getOpenRouterApiKey } = await import("../lib/openrouter-credentials");
  let apiKey = await getOpenRouterApiKey();
  if (!apiKey) throw new Error("La chiave OpenRouter locale non è configurata.");

  const previousDataDirectory = process.env.FORGECY_DATA_DIR;
  const previousApiKey = process.env.OPENROUTER_API_KEY;
  const previousTextModel = process.env.OPENROUTER_MODEL;
  const isolatedDirectory = mkdtempSync(join(tmpdir(), "forgecy-live-document-eval-"));
  let db: ReturnType<(typeof import("../lib/local-db"))["localDb"]> | undefined;
  try {
    process.env.FORGECY_DATA_DIR = isolatedDirectory;
    process.env.OPENROUTER_API_KEY = apiKey;
    if (preferences.text_model) process.env.OPENROUTER_MODEL = preferences.text_model;

    const { localDb, LOCAL_OWNER_ID } = await import("../lib/local-db");
    db = localDb();
    const clientResult = await db.from("clients").insert({
      owner_id: LOCAL_OWNER_ID,
      name: "Forgecy Synthetic Document Evaluation",
      industry: "Evaluation sintetica",
      profile: {},
    }).select("id").single();
    if (clientResult.error || !clientResult.data) throw new Error("Impossibile creare il workspace temporaneo di valutazione.");
    const clientId = String(clientResult.data.id);
    const existingOffer = await db.from("offers").insert({
      client_id: clientId,
      kind: "product",
      name: "Crema Calendula Viso 50 ml",
      description: "Balsamo viso con estratto di calendula e olio di jojoba per pelle sensibile.",
      price: 18.9,
      currency: "EUR",
      status: "verified",
    }).select("id").single();
    if (existingOffer.error || !existingOffer.data) throw new Error("Impossibile preparare il prodotto sintetico esistente.");

    const textModel = preferences.text_model || process.env.OPENROUTER_MODEL || "~deepseek/deepseek-flash-latest";
    const ocrModel = preferences.ocr_model || "deepseek/deepseek-v4.1-flash";
    db.connection.prepare(`INSERT INTO ai_preferences(owner_id,text_model,ocr_model,semantic_enabled,updated_at)
      VALUES(?,?,?,1,?) ON CONFLICT(owner_id) DO UPDATE SET
      text_model=excluded.text_model,ocr_model=excluded.ocr_model,updated_at=excluded.updated_at`)
      .run(LOCAL_OWNER_ID, textModel, ocrModel, new Date().toISOString());

    const canvas = createCanvas(1500, 2100);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, 1500, 2100);
    context.fillStyle = "#173f32"; context.font = "bold 66px Arial";
    context.fillText("CATALOGO PRODOTTI", 110, 180);
    context.fillStyle = "#111111"; context.font = "bold 44px Arial";
    context.fillText("Crema Calendula Viso 50 ml", 110, 400);
    context.font = "36px Arial";
    context.fillText("Balsamo viso con estratto di calendula", 110, 480);
    context.fillText("e olio di jojoba per pelle sensibile.", 110, 535);
    context.font = "bold 38px Arial"; context.fillText("Prezzo: EUR 19.90", 110, 610);
    context.strokeStyle = "#9ca3af"; context.lineWidth = 3;
    context.beginPath(); context.moveTo(110, 710); context.lineTo(1390, 710); context.stroke();
    context.font = "bold 44px Arial"; context.fillText("Olio di Jojoba Puro 30 ml", 110, 850);
    context.font = "36px Arial"; context.fillText("Olio vegetale puro, senza profumo aggiunto.", 110, 930);
    context.font = "bold 38px Arial"; context.fillText("Prezzo: EUR 12.50", 110, 1000);

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const image = await pdf.embedPng(canvas.toBuffer("image/png"));
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
    const bytes = new Uint8Array(await pdf.save());

    const form = new FormData();
    form.append("file", new File([bytes], "catalogo-sintetico-scansione.pdf", { type: "application/pdf" }));
    const { POST } = await import("../app/api/workspace/[...parts]/route");
    const response = await POST(new Request(`http://localhost/api/workspace/clients/${clientId}/upload`, { method: "POST", body: form }), {
      params: Promise.resolve({ parts: ["clients", clientId, "upload"] }),
    });
    const payload = await response.json() as {
      error?: string;
      extracted?: boolean;
      source?: { status?: string; source_metadata?: { document_processing?: { method?: string } } };
      catalog?: { status?: string; added?: number; updated?: number; invalid?: number };
    };
    if (!response.ok) throw new Error(payload.error || `Upload sintetico fallito (HTTP ${response.status}).`);

    const offers = await db.from("offers").select("id,name,price,status,catalog_locked").eq("client_id", clientId).eq("kind", "product");
    if (offers.error) throw new Error("Impossibile verificare la riconciliazione del catalogo sintetico.");
    const existingAfter = offers.data?.find((offer: Record<string, unknown>) => offer.id === existingOffer.data!.id) as Record<string, unknown> | undefined;
    const usage = db.connection.prepare("SELECT count(*) requests,sum(reported_cost_usd) reported_cost_usd FROM ai_provider_usage WHERE client_id=?").get(clientId) as { requests: number; reported_cost_usd: number | null };
    const outcome = {
      isolatedWorkspace: true,
      syntheticScannedPdfPages: 1,
      httpStatus: response.status,
      extracted: payload.extracted === true,
      ocrMethod: payload.source?.source_metadata?.document_processing?.method || null,
      catalog: payload.catalog || null,
      productRows: offers.data?.length || 0,
      existingProductPriceUpdated: existingAfter?.price === 19.9,
      providerRequestsRecorded: usage.requests,
      reportedCostUsd: usage.reported_cost_usd,
      userWorkspaceModified: false,
      credentialPrintedOrWritten: false,
    };
    console.log(JSON.stringify(outcome, null, 2));
    if (!outcome.extracted || outcome.catalog?.status !== "processed" || !outcome.existingProductPriceUpdated || !outcome.catalog.added)
      process.exitCode = 1;
  } finally {
    db?.connection.close();
    delete (globalThis as typeof globalThis & { __forgecyLocalDb?: unknown }).__forgecyLocalDb;
    if (previousDataDirectory === undefined) delete process.env.FORGECY_DATA_DIR;
    else process.env.FORGECY_DATA_DIR = previousDataDirectory;
    if (previousApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousApiKey;
    if (previousTextModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previousTextModel;
    apiKey = "";
    rmSync(isolatedDirectory, { recursive: true, force: true });
  }
}

void main().catch(error => {
  console.error("Live document evaluation failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
