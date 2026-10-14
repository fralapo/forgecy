import { z } from "zod";
import { ApiFailure, auth, dbError, fail, json, read } from "@/lib/http";
import { defaultImageModel, defaultTextModel, loadOpenRouterCatalog, loadOpenRouterCatalogs } from "@/lib/ai-model-settings";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await auth();
    const [catalogs, preference] = await Promise.all([
      loadOpenRouterCatalogs(),
      ctx.db.from("ai_preferences").select("text_model,image_model")
        .eq("owner_id", ctx.user.id).maybeSingle()
    ]);
    dbError(preference.error, "Impossibile leggere le preferenze AI");
    return json({
      ...catalogs,
      preferences: {
        textModel: preference.data?.text_model || defaultTextModel(),
        imageModel: preference.data?.image_model || defaultImageModel()
      }
    });
  } catch (error) { return fail(error); }
}

const selectionSchema = z.object({
  kind: z.enum(["text", "image"]),
  modelId: z.string().min(1).max(180)
}).strict();

export async function PATCH(request: Request) {
  try {
    const ctx = await auth();
    const selection = await read(request, selectionSchema);
    const catalog = selection.kind === "text"
      ? await loadOpenRouterCatalog("text")
      : await loadOpenRouterCatalog("image");
    if (!catalog.some(model => model.id === selection.modelId))
      throw new ApiFailure(409, "Il modello non è più disponibile nel catalogo OpenRouter. Aggiorna la lista.");

    const existing = await ctx.db.from("ai_preferences")
      .select("text_model,image_model").eq("owner_id", ctx.user.id).maybeSingle();
    dbError(existing.error, "Impossibile leggere le preferenze AI");
    const row = {
      owner_id: ctx.user.id,
      text_model: selection.kind === "text" ? selection.modelId : existing.data?.text_model || null,
      image_model: selection.kind === "image" ? selection.modelId : existing.data?.image_model || null,
      updated_at: new Date().toISOString()
    };
    const saved = await ctx.db.from("ai_preferences").upsert(row, { onConflict: "owner_id" })
      .select("text_model,image_model").single();
    dbError(saved.error, "Impossibile salvare le preferenze AI");
    if (!saved.data) throw new ApiFailure(500, "Impossibile confermare le preferenze AI salvate");
    return json({ preferences: { textModel: saved.data.text_model, imageModel: saved.data.image_model } });
  } catch (error) { return fail(error); }
}
