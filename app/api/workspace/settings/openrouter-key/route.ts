import { z } from "zod";
import { fail, json, read } from "@/lib/http";
import { openRouterKeyStatus, removeOpenRouterApiKey, saveOpenRouterApiKey, validateOpenRouterApiKey } from "@/lib/openrouter-credentials";

export const runtime = "nodejs";

export async function GET() {
  try { return json({ key: await openRouterKeyStatus() }); }
  catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  try {
    const input = await read(request, z.object({ apiKey: z.string().trim().min(20).max(512) }).strict());
    await validateOpenRouterApiKey(input.apiKey);
    await saveOpenRouterApiKey(input.apiKey);
    return json({ key: await openRouterKeyStatus(), message: "Chiave OpenRouter verificata e salvata su questo computer." });
  } catch (error) { return fail(error); }
}

export async function DELETE() {
  try {
    await removeOpenRouterApiKey();
    const key = await openRouterKeyStatus();
    return json({ key, message: key.source === "environment"
      ? "Chiave salvata nell'app rimossa. Rimane attiva quella configurata in .env.local."
      : "Chiave OpenRouter rimossa dal computer." });
  } catch (error) { return fail(error); }
}
