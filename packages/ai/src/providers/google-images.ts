import { AiProviderError, classifyError, kindForStatus } from "../errors";
import type { GeneratedImage, ImageGenerationInput, ImageProvider, Usage } from "../types";
import { createJobStore, nearestAspect } from "./images-common";

/**
 * Gemini image generation through the REST API with plain fetch (no SDK dependency).
 *
 * TO VERIFY before M5: endpoint, model ids and response shape. Written against
 * `models/{model}:generateContent` with `generationConfig.responseModalities: ["IMAGE"]`
 * and `imageConfig.aspectRatio`, reading `candidates[].content.parts[].inlineData`.
 * Google also documents a newer `/v1beta/interactions` endpoint; switch if
 * generateContent stops accepting image models.
 */
export const GOOGLE_IMAGE_DEFAULT_MODEL = "gemini-3.1-flash-image";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

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
  { ar: "21:9", ratio: 21 / 9 },
] as const;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

export interface GoogleImageProviderOptions {
  apiKey: string;
  baseURL?: string;
  fetch?: typeof fetch;
}

export function createGoogleImageProvider(opts: GoogleImageProviderOptions): ImageProvider {
  const doFetch = opts.fetch ?? fetch;
  const base = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const store = createJobStore();

  async function once(
    input: ImageGenerationInput,
  ): Promise<{ images: GeneratedImage[]; usage: Usage }> {
    const signals = [AbortSignal.timeout(input.timeoutMs), ...(input.signal ? [input.signal] : [])];
    let res: Response;
    try {
      res = await doFetch(`${base}/models/${encodeURIComponent(input.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: nearestAspect(input.size, ratios).ar },
          },
        }),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      throw classifyError(err, "google");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AiProviderError(
        kindForStatus(res.status),
        `Gemini HTTP ${res.status}: ${body.slice(0, 300)}`,
        {
          status: res.status,
          provider: "google",
        },
      );
    }
    const json = (await res.json()) as GeminiResponse;
    if (json.promptFeedback?.blockReason) {
      throw new AiProviderError(
        "content_filter",
        `Gemini blocked the prompt: ${json.promptFeedback.blockReason}`,
        { provider: "google" },
      );
    }
    const images: GeneratedImage[] = [];
    for (const c of json.candidates ?? []) {
      for (const p of c.content?.parts ?? []) {
        if (p.inlineData?.data) {
          images.push({
            data: new Uint8Array(Buffer.from(p.inlineData.data, "base64")),
            mimeType: p.inlineData.mimeType ?? "image/png",
          });
        }
      }
    }
    return {
      images,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        images: images.length,
      },
    };
  }

  return {
    id: "google",
    async generate(input) {
      // One image per request: run the variants sequentially to stay under rate limits.
      const all: GeneratedImage[] = [];
      const usage: Usage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        images: 0,
      };
      for (let i = 0; i < input.variants; i++) {
        const r = await once(input);
        all.push(...r.images);
        usage.inputTokens += r.usage.inputTokens;
        usage.outputTokens += r.usage.outputTokens;
        usage.images = (usage.images ?? 0) + (r.usage.images ?? 0);
      }
      if (all.length === 0)
        throw new AiProviderError("invalid_output", "Gemini returned no image data", {
          provider: "google",
        });
      return store.put({ state: "succeeded", images: all, usage, model: input.model });
    },
    async getStatus(jobId) {
      return store.get(jobId);
    },
  };
}
