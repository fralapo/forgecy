import OpenAI from "openai";
import { AiProviderError, classifyError } from "../errors";
import type { GeneratedImage, ImageGenerationInput, ImageProvider } from "../types";
import { createJobStore, nearestAspect } from "./images-common";

export const OPENAI_IMAGE_DEFAULT_MODEL = "gpt-image-2";

/** Sizes every gpt-image model accepts. The renderer crops/scales to the slot. */
const sizes = [
  { size: "1024x1024", ratio: 1 },
  { size: "1024x1536", ratio: 1024 / 1536 },
  { size: "1536x1024", ratio: 1536 / 1024 },
] as const;

export interface OpenAIImageProviderOptions {
  apiKey: string;
  baseURL?: string;
  maxRetries?: number;
  client?: OpenAI;
}

/** OpenAI Images API (gpt-image-*). gpt-image models always return base64 (`b64_json`). */
export function createOpenAIImageProvider(opts: OpenAIImageProviderOptions): ImageProvider {
  const client =
    opts.client ??
    new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      maxRetries: opts.maxRetries ?? 2,
    });
  const store = createJobStore();

  return {
    id: "openai",
    async generate(input: ImageGenerationInput) {
      let res: OpenAI.Images.ImagesResponse;
      try {
        res = await client.images.generate(
          {
            model: input.model,
            prompt: input.prompt,
            n: input.variants,
            size: nearestAspect(input.size, sizes).size,
            output_format: "png",
          },
          { timeout: input.timeoutMs, ...(input.signal ? { signal: input.signal } : {}) },
        );
      } catch (err) {
        throw classifyError(err, "openai");
      }
      const images: GeneratedImage[] = (res.data ?? [])
        .filter((d) => typeof d.b64_json === "string")
        .map((d) => ({
          data: new Uint8Array(Buffer.from(d.b64_json!, "base64")),
          mimeType: "image/png",
        }));
      const usage = {
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        images: images.length,
      };
      if (images.length === 0)
        throw new AiProviderError("invalid_output", "OpenAI returned no image data", {
          provider: "openai",
          usage,
        });
      return store.put({ state: "succeeded", images, model: input.model, usage });
    },
    async getStatus(jobId) {
      return store.get(jobId);
    },
  };
}
