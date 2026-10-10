import type { AiPolicy, ProviderId } from "@forgecy/core";

export type { AiPolicy, ProviderId };

/** Every AI step Forgecy runs. Routing, prompts and logging are keyed by task. */
export const aiTasks = [
  "audit_analyze",
  "audit_diagnose",
  "audit_plan",
  "audit_report",
  "scan",
  "content_strategy",
  "outline",
  "slides",
  "edit_slide",
  "critique_claims",
  "image_prompt",
  "brand_propose",
  "catalog_extract",
  "creative_direction",
  "test",
] as const;
export type AiTask = (typeof aiTasks)[number];

/** Normalized token usage. `inputTokens` excludes cache reads and cache writes. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Number of images produced (image calls only). */
  images?: number;
  /** Cost the provider itself reported in USD (e.g. OpenRouter); overrides the price table. */
  providerCostUsd?: number;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export function addUsage(a: Usage, b: Usage): Usage {
  const out: Usage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
  if (a.images !== undefined || b.images !== undefined)
    out.images = (a.images ?? 0) + (b.images ?? 0);
  if (a.providerCostUsd !== undefined || b.providerCostUsd !== undefined) {
    out.providerCostUsd = (a.providerCostUsd ?? 0) + (b.providerCostUsd ?? 0);
  }
  return out;
}

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

export type JsonSchema = Record<string, unknown>;

/** Image formats every vision-capable adapter accepts (Anthropic, OpenAI, OpenRouter, Ollama). */
export const inputImageMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type InputImageMimeType = (typeof inputImageMimeTypes)[number];

/** Image sent to a model as input (vision), e.g. a social profile screenshot. */
export interface InputImage {
  data: Uint8Array;
  mimeType: InputImageMimeType;
  /** Optional reference (file key, asset id) logged next to the hash; never the image itself. */
  id?: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** Images placed before the text of a user turn. Ignored on assistant turns. */
  images?: InputImage[];
}

/** Normalized stop reason. Providers keep the raw value in `rawStopReason`. */
export type StopReason = "end" | "max_tokens" | "refusal" | "content_filter" | "other";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** What the gateway asks a text adapter to do: one request, JSON output constrained by `jsonSchema`. */
export interface TextGenerationRequest {
  model: string;
  /** Stable system prompt; adapters that support it mark it for prompt caching. */
  system: string;
  messages: ChatTurn[];
  jsonSchema: JsonSchema;
  schemaName: string;
  maxOutputTokens: number;
  timeoutMs: number;
  effort?: Effort;
  signal?: AbortSignal;
}

export interface TextGenerationResult {
  /** Raw text returned by the model (expected to be JSON). */
  text: string;
  /** `JSON.parse(text)` when it parses, otherwise undefined. */
  parsed?: unknown;
  usage: Usage;
  stopReason: StopReason;
  rawStopReason?: string | null;
  /** Refusal explanation when `stopReason === "refusal"`. */
  refusal?: string;
  /** Model id the provider reports having used. */
  model: string;
}

export interface TextProvider {
  readonly id: ProviderId;
  generateObject(req: TextGenerationRequest): Promise<TextGenerationResult>;
}

// ---- Images ----

export interface ImageSize {
  w: number;
  h: number;
}

export interface ImageGenerationInput {
  model: string;
  prompt: string;
  size: ImageSize;
  variants: 1 | 2 | 3 | 4;
  timeoutMs: number;
  /**
   * Visual references the model should match (the client's brand images). Only the
   * OpenRouter provider sends them; the others ignore the field.
   */
  references?: InputImage[];
  signal?: AbortSignal;
}

export interface GeneratedImage {
  data: Uint8Array;
  mimeType: string;
}

export type ImageJobState = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface ImageGenerationStatus {
  jobId: string;
  state: ImageJobState;
  images?: GeneratedImage[];
  usage?: Usage;
  model?: string;
  error?: string;
}

/** Synchronous providers return a finished job; async ones (ComfyUI, GPU servers) return queued. */
export type ImageGenerationJob = ImageGenerationStatus;

export interface ImageProvider {
  readonly id: ProviderId;
  /** True when `generate` really sends `input.references` to the model (OpenRouter). */
  readonly acceptsReferences?: boolean;
  generate(input: ImageGenerationInput): Promise<ImageGenerationJob>;
  getStatus(jobId: string): Promise<ImageGenerationStatus>;
  cancel?(jobId: string): Promise<void>;
}

export interface ProviderSet {
  text: Partial<Record<ProviderId, TextProvider>>;
  image: Partial<Record<ProviderId, ImageProvider>>;
}
