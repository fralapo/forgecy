import { z } from "zod";
import { ApiFailure, auth, dbError, fail, json, read } from "@/lib/http";
import { defaultImageModel, defaultTextModel, loadOpenRouterCatalog, loadOpenRouterCatalogs, readOcrModelPreference } from "@/lib/ai-model-settings";
import { DEFAULT_OCR_MODEL } from "@/lib/ai-model-defaults";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await auth();
    const [catalogs, preference, ocrModel] = await Promise.all([
      loadOpenRouterCatalogs(),
      ctx.db.from("ai_preferences").select("text_model,image_model")
        .eq("owner_id", ctx.user.id).maybeSingle(),
      readOcrModelPreference(ctx.user.id)
    ]);
    dbError(preference.error, "Impossibile leggere le preferenze AI");
    return json({
      ...catalogs,
      preferences: {
        textModel: preference.data?.text_model || defaultTextModel(),
        imageModel: preference.data?.image_model || defaultImageModel(),
        ocrModel: ocrModel || DEFAULT_OCR_MODEL
      }
    });
  } catch (error) { return fail(error); }
}

const selectionSchema = z.object({
  kind: z.enum(["text", "image", "ocr"]),
  modelId: z.string().min(1).max(180)
}).strict();

export async function PATCH(request: Request) {
  try {
    const ctx = await auth();
    const selection = await read(request, selectionSchema);
    const catalog = selection.kind === "text" ? await loadOpenRouterCatalog("text")
      : selection.kind === "ocr" ? await loadOpenRouterCatalog("vision")
      : await loadOpenRouterCatalog("image");
    if (!catalog.some(model => model.id === selection.modelId))
      throw new ApiFailure(409, "Il modello non è più disponibile nel catalogo OpenRouter. Aggiorna la lista.");

    const existing = await ctx.db.from("ai_preferences")
      .select("text_model,image_model,ocr_model").eq("owner_id", ctx.user.id).maybeSingle();
    dbError(existing.error, "Impossibile leggere le preferenze AI");
    const row = {
      owner_id: ctx.user.id,
      text_model: selection.kind === "text" ? selection.modelId : existing.data?.text_model || null,
      image_model: selection.kind === "image" ? selection.modelId : existing.data?.image_model || null,
      ocr_model: selection.kind === "ocr" ? selection.modelId : existing.data?.ocr_model || null,
      updated_at: new Date().toISOString()
    };
    const saved = await ctx.db.from("ai_preferences").upsert(row, { onConflict: "owner_id" })
      .select("text_model,image_model,ocr_model").single();
    dbError(saved.error, "Impossibile salvare le preferenze AI");
    if (!saved.data) throw new ApiFailure(500, "Impossibile confermare le preferenze AI salvate");
    return json({ preferences: { textModel: saved.data.text_model, imageModel: saved.data.image_model, ocrModel: saved.data.ocr_model || DEFAULT_OCR_MODEL } });
  } catch (error) { return fail(error); }
}
