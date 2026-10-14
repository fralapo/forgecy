import { z } from "zod";
import { auth, fail, json, read, ApiFailure } from "@/lib/http";
import { getLocalDatabase } from "@/lib/local-db";
import { localOcrStatus, maybeStartAutomaticUpdate, startLocalOcrInstall, type OcrProvider } from "@/lib/local-ocr";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await auth();
    const db = getLocalDatabase();
    const row = db.prepare("SELECT ocr_provider,ocr_auto_update FROM ai_preferences WHERE owner_id=?").get(ctx.user.id) as { ocr_provider?: string; ocr_auto_update?: number } | undefined;
    const preferences = { provider: (row?.ocr_provider || "auto") as OcrProvider, autoUpdate: row?.ocr_auto_update !== 0 };
    const status = await localOcrStatus();
    const operation = maybeStartAutomaticUpdate(status, preferences.autoUpdate);
    return json({ preferences, ...status, operation: operation || status.operation });
  } catch (error) { return fail(error); }
}

const preferencesSchema = z.object({ provider: z.enum(["auto", "openrouter", "local"]).optional(), autoUpdate: z.boolean().optional() }).strict().refine(value => value.provider !== undefined || value.autoUpdate !== undefined);
export async function PATCH(request: Request) {
  try {
    const ctx = await auth();
    const value = await read(request, preferencesSchema);
    const db = getLocalDatabase();
    const previous = db.prepare("SELECT ocr_provider,ocr_auto_update FROM ai_preferences WHERE owner_id=?").get(ctx.user.id) as { ocr_provider?: string; ocr_auto_update?: number } | undefined;
    db.prepare(`INSERT INTO ai_preferences(owner_id,ocr_provider,ocr_auto_update,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(owner_id) DO UPDATE SET ocr_provider=excluded.ocr_provider,ocr_auto_update=excluded.ocr_auto_update,updated_at=excluded.updated_at`)
      .run(ctx.user.id, value.provider || previous?.ocr_provider || "auto", value.autoUpdate === undefined ? previous?.ocr_auto_update ?? 1 : Number(value.autoUpdate), new Date().toISOString());
    return json({ preferences: { provider: value.provider || previous?.ocr_provider || "auto", autoUpdate: value.autoUpdate ?? previous?.ocr_auto_update !== 0 } });
  } catch (error) { return fail(error); }
}

const actionSchema = z.object({ action: z.enum(["install", "update", "check"]) }).strict();
export async function POST(request: Request) {
  try {
    await auth();
    const { action } = await read(request, actionSchema);
    const status = await localOcrStatus();
    if (action === "check") return json({ ...status, checkedAt: new Date().toISOString() });
    const version = action === "update" ? status.latestVersion : status.installedVersion || status.latestVersion;
    if (!version) throw new ApiFailure(503, "Non riesco a verificare l'ultima versione stabile di PaddleOCR. Controlla la connessione e riprova.");
    if (action === "update" && !status.updateAvailable) return json({ ...status, message: "Il parser installato è già aggiornato." });
    const operation = startLocalOcrInstall(version);
    return json({ operation }, 202);
  } catch (error) { return fail(error); }
}
