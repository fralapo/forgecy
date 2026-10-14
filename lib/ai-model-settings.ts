import { AsyncLocalStorage } from "node:async_hooks";
import { ApiFailure } from "./http";
import { workerDb } from "./worker-db";

export type OpenRouterModel = {
  id: string;
  name: string;
  description: string;
  structuredOutputs: boolean;
};

export type OpenRouterImageModel = Pick<OpenRouterModel, "id" | "name" | "description"> & {
  supportedAspectRatios: string[];
};
type Fetcher = typeof fetch;
const textModelStorage = new AsyncLocalStorage<string>();
const OPENROUTER = "https://openrouter.ai/api/v1";
const CATALOG_TIMEOUT_MS = 15_000;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function modelId(value: unknown): string | null {
  return typeof value === "string" && /^[~a-zA-Z0-9][a-zA-Z0-9._:/-]{0,179}$/.test(value)
    ? value : null;
}

export function normalizeTextModels(payload: unknown): OpenRouterModel[] {
  const data = object(payload).data;
  if (!Array.isArray(data)) throw new ApiFailure(502, "Catalogo OpenRouter testo non valido");
  return data.flatMap((entry): OpenRouterModel[] => {
    const row = object(entry);
    const id = modelId(row.id);
    if (!id) return [];
    const supported = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
    return [{
      id,
      name: typeof row.name === "string" && row.name.trim() ? row.name.slice(0, 180) : id,
      description: typeof row.description === "string" ? row.description.slice(0, 500) : "",
      structuredOutputs: supported.includes("structured_outputs")
    }];
  });
}

export function normalizeImageModels(payload: unknown): OpenRouterImageModel[] {
  const data = object(payload).data;
  if (!Array.isArray(data)) throw new ApiFailure(502, "Catalogo OpenRouter immagini non valido");
  return data.flatMap((entry): OpenRouterImageModel[] => {
    const row = object(entry);
    const id = modelId(row.id);
    if (!id) return [];
    const supportedParameters = object(row.supported_parameters);
    const aspectRatio = object(supportedParameters.aspect_ratio);
    const supportedAspectRatios = Array.isArray(aspectRatio.values)
      ? aspectRatio.values.filter((value): value is string => typeof value === "string" && value.length <= 16)
      : [];
    return [{
      id,
      name: typeof row.name === "string" && row.name.trim() ? row.name.slice(0, 180) : id,
      description: typeof row.description === "string" ? row.description.slice(0, 500) : "",
      supportedAspectRatios
    }];
  });
}

async function catalogRequest(path: string, fetcher: Fetcher): Promise<unknown> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new ApiFailure(503, "Configura OPENROUTER_API_KEY nel server per caricare i modelli");
  let response: Response;
  try {
    response = await fetcher(OPENROUTER + path, {
      headers: { Authorization: "Bearer " + key, "X-Title": "Forgecy" },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS), cache: "no-store"
    });
  } catch {
    throw new ApiFailure(502, "OpenRouter non è raggiungibile. Aggiorna il catalogo per riprovare.");
  }
  if (!response.ok) {
    console.error("[openrouter catalog] HTTP", response.status);
    throw new ApiFailure(response.status === 401 ? 503 : 502,
      response.status === 401 ? "La chiave OpenRouter non è valida" : "Impossibile caricare il catalogo OpenRouter");
  }
  try { return await response.json(); }
  catch { throw new ApiFailure(502, "OpenRouter ha restituito un catalogo non valido"); }
}

export async function loadOpenRouterCatalogs(fetcher: Fetcher = fetch) {
  const [textPayload, imagePayload] = await Promise.all([
    catalogRequest("/models?output_modalities=text", fetcher),
    catalogRequest("/images/models", fetcher)
  ]);
  return {
    textModels: normalizeTextModels(textPayload),
    imageModels: normalizeImageModels(imagePayload)
  };
}

export function loadOpenRouterCatalog(kind: "text", fetcher?: Fetcher): Promise<OpenRouterModel[]>;
export function loadOpenRouterCatalog(kind: "image", fetcher?: Fetcher): Promise<OpenRouterImageModel[]>;
export async function loadOpenRouterCatalog(kind: "text" | "image", fetcher: Fetcher = fetch) {
  const path = kind === "text" ? "/models?output_modalities=text" : "/images/models";
  const payload = await catalogRequest(path, fetcher);
  return kind === "text" ? normalizeTextModels(payload) : normalizeImageModels(payload);
}

export function currentTextModel() {
  return textModelStorage.getStore() || process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";
}

export function withTextModel<T>(model: string | null | undefined, work: () => Promise<T>): Promise<T> {
  return textModelStorage.run(model || process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini", work);
}

export function defaultTextModel() {
  return process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";
}

async function readTextPreference(userId: string): Promise<string | null> {
  const { data, error } = await workerDb().from("ai_preferences")
    .select("text_model").eq("owner_id", userId).maybeSingle();
  if (error) {
    console.error("[ai settings] Could not read text model preference", error.code || "database error");
    throw new ApiFailure(503, "Impossibile leggere il modello AI salvato dal workspace locale.");
  }
  return data?.text_model || null;
}

export async function withUserTextModel<T>(
  userId: string, work: () => Promise<T>, reader = readTextPreference
): Promise<T> {
  const selected = await reader(userId);
  return withTextModel(selected, work);
}

export function validModelId(value: unknown): value is string {
  return modelId(value) !== null;
}
