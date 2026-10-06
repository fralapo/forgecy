import OpenAI from "openai";
import type { ProviderId } from "@forgecy/core";
import { classifyError } from "../errors";
import { isStrictCompatible } from "../schema";
import type {
  StopReason,
  TextGenerationRequest,
  TextGenerationResult,
  TextProvider,
} from "../types";

export const OPENAI_DEFAULT_MODEL = "gpt-6.1-sol";
export const OPENROUTER_DEFAULT_MODEL = "openrouter/auto";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const LOCAL_DEFAULT_MODEL = "llama3.1:8b";

export interface OpenAICompatibleOptions {
  id: Extract<ProviderId, "openai" | "openrouter" | "local">;
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
  /**
   * Send `strict: true` when the schema allows it. OpenAI honours it; Ollama and
   * LM Studio accept `response_format: json_schema` and constrain decoding with it.
   */
  strict?: boolean;
  client?: OpenAI;
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

/**
 * Chat Completions with `response_format: { type: "json_schema" }`. Used for
 * OpenAI, OpenRouter and local servers (Ollama / LM Studio) because it is the
 * common denominator of the OpenAI-compatible endpoints.
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
              { role: "system", content: req.system },
              ...req.messages.map((m) => ({ role: m.role, content: m.content })),
            ],
            response_format: {
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
      const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
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
