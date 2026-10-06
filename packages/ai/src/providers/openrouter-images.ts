import { AiProviderError, classifyError, kindForStatus } from "../errors";
import {
  addUsage,
  type GeneratedImage,
  type ImageGenerationInput,
  type ImageProvider,
  type Usage,
} from "../types";
import { createJobStore, nearestAspect } from "./images-common";
import { OPENROUTER_BASE_URL } from "./openai-compatible";

/**
 * Image models through OpenRouter's Chat Completions (`modalities: ["image", "text"]`),
 * plain fetch because `images` on the message is not in the OpenAI SDK types.
 * Images come back as data URLs in `choices[].message.images[].image_url.url`;
 * `image_config.aspect_ratio` is honoured by the models that support it (Gemini, FLUX...).
 * Reference: openrouter.ai/docs/features/multimodal/image-generation (checked 2026-10-06).
 */
export const OPENROUTER_IMAGE_DEFAULT_MODEL = "google/gemini-3.1-flash-image-preview";

const ratios = [
  { ar: "1:1", ratio: 1 },
  { ar: "4:5", ratio: 4 / 5 },
  { ar: "5:4", ratio: 5 / 4 },
  { ar: "3:4", ratio: 3 / 4 },
  { ar: "4:3", ratio: 4 / 3 },
  { ar: "2:3", ratio: 2 / 3 },
  { ar: "3:2", ratio: 3 / 2 },
  { ar: "9:16", ratio: 9 / 16 },
  { ar: "16:9", ratio: 16 / 9 },
] as const;

interface OpenRouterImageResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
      images?: Array<{ type?: string; image_url?: { url?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

export interface OpenRouterImageProviderOptions {
  apiKey: string;
  baseURL?: string;
  /** Attribution headers (HTTP-Referer, X-Title) documented by OpenRouter. */
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
}

/** Decode `data:<mime>;base64,<data>`; other URLs are not expected from OpenRouter. */
export function decodeDataUrl(url: string): GeneratedImage | undefined {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!m) return undefined;
  return { data: new Uint8Array(Buffer.from(m[2]!, "base64")), mimeType: m[1]! };
}

export function createOpenRouterImageProvider(opts: OpenRouterImageProviderOptions): ImageProvider {
  const doFetch = opts.fetch ?? fetch;
  const base = (opts.baseURL ?? OPENROUTER_BASE_URL).replace(/\/$/, "");
  const store = createJobStore();

  async function once(
    input: ImageGenerationInput,
  ): Promise<{ images: GeneratedImage[]; usage: Usage; model: string }> {
    const signals = [AbortSignal.timeout(input.timeoutMs), ...(input.signal ? [input.signal] : [])];
    let res: Response;
    try {
      res = await doFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
          ...opts.defaultHeaders,
        },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: "user", content: input.prompt }],
          modalities: ["image", "text"],
          image_config: { aspect_ratio: nearestAspect(input.size, ratios).ar },
        }),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      throw classifyError(err, "openrouter");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AiProviderError(
        kindForStatus(res.status),
        `OpenRouter HTTP ${res.status}: ${body.slice(0, 300)}`,
        { status: res.status, provider: "openrouter" },
      );
    }
    const json = (await res.json()) as OpenRouterImageResponse;
    const choice = json.choices?.[0];
    if (choice?.message?.refusal)
      throw new AiProviderError("refusal", `OpenRouter refused: ${choice.message.refusal}`, {
        provider: "openrouter",
      });
    if (choice?.finish_reason === "content_filter")
      throw new AiProviderError("content_filter", "OpenRouter blocked the prompt", {
        provider: "openrouter",
      });
    const images = (choice?.message?.images ?? [])
      .map((i) => (i.image_url?.url ? decodeDataUrl(i.image_url.url) : undefined))
      .filter((i): i is GeneratedImage => !!i);
    const usage: Usage = {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      images: images.length,
    };
    if (typeof json.usage?.cost === "number") usage.providerCostUsd = json.usage.cost;
    return { images, usage, model: json.model || input.model };
  }

  return {
    id: "openrouter",
    async generate(input) {
      // Most image models answer with one image per request: run the variants in sequence.
      const all: GeneratedImage[] = [];
      let usage: Usage | undefined;
      let model = input.model;
      for (let i = 0; i < input.variants; i++) {
        const r = await once(input);
        all.push(...r.images);
        model = r.model;
        usage = usage ? addUsage(usage, r.usage) : r.usage;
      }
      if (all.length === 0 || !usage)
        throw new AiProviderError("invalid_output", "OpenRouter returned no image data", {
          provider: "openrouter",
        });
      return store.put({ state: "succeeded", images: all, usage, model });
    },
    async getStatus(jobId) {
      return store.get(jobId);
    },
  };
}
