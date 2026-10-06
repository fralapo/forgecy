import type { ProviderId } from "@forgecy/core";
import { AiProviderError, type AiErrorKind } from "../errors";
import type {
  ImageGenerationInput,
  ImageProvider,
  TextGenerationRequest,
  TextGenerationResult,
  TextProvider,
  Usage,
} from "../types";
import { createJobStore } from "./images-common";

/** One scripted reaction of the fake provider, consumed in order. */
export type FakeStep =
  | { json: unknown; usage?: Partial<Usage> }
  | { text: string; usage?: Partial<Usage> }
  | { error: AiErrorKind; status?: number; message?: string }
  | { refusal: string }
  | { maxTokens: string }
  | ((req: TextGenerationRequest) => TextGenerationResult | Promise<TextGenerationResult>);

export interface FakeTextProvider extends TextProvider {
  readonly calls: TextGenerationRequest[];
  push(...steps: FakeStep[]): void;
}

const usageOf = (u?: Partial<Usage>): Usage => ({
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...u,
});

/** Deterministic, network-free text provider for tests. Throws when the script runs out. */
export function createFakeTextProvider(
  id: ProviderId = "anthropic",
  steps: FakeStep[] = [],
): FakeTextProvider {
  const queue = [...steps];
  const calls: TextGenerationRequest[] = [];
  return {
    id,
    calls,
    push(...more) {
      queue.push(...more);
    },
    async generateObject(req) {
      calls.push(structuredClone({ ...req, signal: undefined }));
      const step = queue.shift();
      if (!step) throw new Error(`fake provider "${id}": no scripted response left`);
      if (typeof step === "function") return step(req);
      if ("error" in step) {
        throw new AiProviderError(step.error, step.message ?? `fake ${step.error}`, {
          provider: id,
          ...(step.status !== undefined ? { status: step.status } : {}),
        });
      }
      if ("refusal" in step) {
        return {
          text: "",
          usage: usageOf({ outputTokens: 0 }),
          stopReason: "refusal",
          refusal: step.refusal,
          model: req.model,
        };
      }
      if ("maxTokens" in step) {
        return {
          text: step.maxTokens,
          usage: usageOf(),
          stopReason: "max_tokens",
          model: req.model,
        };
      }
      const text = "json" in step ? JSON.stringify(step.json) : step.text;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const result: TextGenerationResult = {
        text,
        usage: usageOf(step.usage),
        stopReason: "end",
        model: req.model,
      };
      if (parsed !== undefined) result.parsed = parsed;
      return result;
    },
  };
}

export interface FakeImageProvider extends ImageProvider {
  readonly calls: ImageGenerationInput[];
}

/** Returns `variants` tiny deterministic byte arrays; `fail` makes every call throw that kind. */
export function createFakeImageProvider(
  id: ProviderId = "openai",
  opts: { fail?: AiErrorKind } = {},
): FakeImageProvider {
  const store = createJobStore();
  const calls: ImageGenerationInput[] = [];
  return {
    id,
    calls,
    async generate(input) {
      calls.push({ ...input, signal: undefined } as ImageGenerationInput);
      if (opts.fail) throw new AiProviderError(opts.fail, `fake ${opts.fail}`, { provider: id });
      const images = Array.from({ length: input.variants }, (_, i) => ({
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, i]),
        mimeType: "image/png",
      }));
      return store.put({
        state: "succeeded",
        images,
        model: input.model,
        usage: { ...usageOf(), images: images.length },
      });
    },
    async getStatus(jobId) {
      return store.get(jobId);
    },
  };
}
