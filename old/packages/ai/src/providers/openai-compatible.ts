import OpenAI from "openai";
import type { ProviderId } from "@forgecy/core";
import { classifyError } from "../errors";
import { isStrictCompatible } from "../schema";
import type {
  ChatTurn,
  StopReason,
  TextGenerationRequest,
  TextGenerationResult,
  TextProvider,
} from "../types";

export const OPENAI_DEFAULT_MODEL = "gpt-6.1-sol";
/**
 * Last-known-good fallback for OpenRouter text, used only when the live catalog
 * (openrouter-catalog.ts) cannot be reached. DeepSeek's "Flash" chat model, picked
 * live by id otherwise so it always tracks whichever version is newest.
 */
export const OPENROUTER_DEFAULT_MODEL = "~deepseek/deepseek-flash-latest";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const LOCAL_DEFAULT_MODEL = "llama3.1:8b";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export interface OpenAICompatibleOptions {
  id: Extract<ProviderId, "openai" | "openrouter" | "local" | "deepseek">;
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
  /**
   * Send `strict: true` when the schema allows it. OpenAI honours it; Ollama and
   * LM Studio accept `response_format: json_schema` and constrain decoding with it.
   */
  strict?: boolean;
  /**
   * `json_schema` (default) constrains decoding with the schema. `json_object` is for
   * endpoints that only guarantee valid JSON (DeepSeek): the schema then goes into the
   * system prompt, which must also contain the word "json", and Zod validates the result.
   */
  jsonMode?: "json_schema" | "json_object";
  client?: OpenAI;
}

/** System prompt plus the schema, for endpoints without `json_schema` support. */
export function withSchemaInstructions(system: string, jsonSchema: unknown): string {
  return `${system}\n\nReply with one JSON object only, no prose, that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
}

function normalizeStop(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "stop":
      return "end";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "content_filter";
    default:
      return "other";
  }
}

function toChatMessage(m: ChatTurn): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (m.role === "assistant") return { role: "assistant", content: m.content };
  if (!m.images?.length) return { role: "user", content: m.content };
  // Data URLs work on OpenAI, OpenRouter, Ollama and LM Studio alike.
  return {
    role: "user",
    content: [
      ...m.images.map((img): OpenAI.Chat.Completions.ChatCompletionContentPartImage => ({
        type: "image_url",
        image_url: {
          url: `data:${img.mimeType};base64,${Buffer.from(img.data).toString("base64")}`,
        },
      })),
      { type: "text", text: m.content },
    ],
  };
}

/**
 * Chat Completions with `response_format: { type: "json_schema" }`. Used for
 * OpenAI, OpenRouter and local servers (Ollama / LM Studio) because it is the
 * common denominator of the OpenAI-compatible endpoints; DeepSeek uses `json_object`.
 */
export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): TextProvider {
  const client =
    opts.client ??
    new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.defaultHeaders ? { defaultHeaders: opts.defaultHeaders } : {}),
      maxRetries: opts.maxRetries ?? 2,
    });
  const useStrict = opts.strict ?? true;
  const jsonMode = opts.jsonMode ?? "json_schema";

  return {
    id: opts.id,
    async generateObject(req: TextGenerationRequest): Promise<TextGenerationResult> {
      let res: OpenAI.Chat.Completions.ChatCompletion;
      try {
        res = await client.chat.completions.create(
          {
            model: req.model,
            // OpenAI deprecated max_tokens; Ollama / LM Studio / OpenRouter still document max_tokens.
            ...(opts.id === "openai"
              ? { max_completion_tokens: req.maxOutputTokens }
              : { max_tokens: req.maxOutputTokens }),
            messages: [
              {
                role: "system",
                content:
                  jsonMode === "json_object"
                    ? withSchemaInstructions(req.system, req.jsonSchema)
                    : req.system,
              },
              ...req.messages.map(toChatMessage),
            ],
            response_format:
              jsonMode === "json_object"
                ? { type: "json_object" }
                : {
                    type: "json_schema",
                    json_schema: {
                      name: req.schemaName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
                      schema: req.jsonSchema,
                      strict: useStrict && isStrictCompatible(req.jsonSchema),
                    },
                  },
            ...(req.effort && opts.id === "openai" ? { reasoning_effort: req.effort } : {}),
          },
          { timeout: req.timeoutMs, ...(req.signal ? { signal: req.signal } : {}) },
        );
      } catch (err) {
        throw classifyError(err, opts.id);
      }

      const choice = res.choices[0];
      const refusal = choice?.message.refusal ?? null;
      const stopReason: StopReason = refusal ? "refusal" : normalizeStop(choice?.finish_reason);
      const text = refusal ? "" : (choice?.message.content ?? "");
      const u = res.usage;
      // DeepSeek reports cache hits as prompt_cache_hit_tokens instead of prompt_tokens_details.
      const deepseekHits = (u as { prompt_cache_hit_tokens?: unknown } | undefined)
        ?.prompt_cache_hit_tokens;
      const cached =
        u?.prompt_tokens_details?.cached_tokens ??
        (typeof deepseekHits === "number" ? deepseekHits : 0);
      const result: TextGenerationResult = {
        text,
        usage: {
          inputTokens: Math.max(0, (u?.prompt_tokens ?? 0) - cached),
          outputTokens: u?.completion_tokens ?? 0,
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
        },
        stopReason,
        rawStopReason: choice?.finish_reason ?? null,
        model: res.model || req.model,
      };
      // OpenRouter reports the billed amount in usage.cost (USD); not in the OpenAI types.
      const reportedCost = (u as { cost?: unknown } | undefined)?.cost;
      if (opts.id === "openrouter" && typeof reportedCost === "number")
        result.usage.providerCostUsd = reportedCost;
      if (refusal) result.refusal = refusal;
      try {
        if (text) result.parsed = JSON.parse(text);
      } catch {
        // Gateway reports it as a validation failure.
      }
      return result;
    },
  };
}
