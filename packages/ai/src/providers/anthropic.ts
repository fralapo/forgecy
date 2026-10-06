import Anthropic from "@anthropic-ai/sdk";
import { classifyError } from "../errors";
import { toAnthropicSchema } from "../schema";
import type {
  ChatTurn,
  StopReason,
  TextGenerationRequest,
  TextGenerationResult,
  TextProvider,
} from "../types";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
  /** SDK-level retries for 408/409/429/5xx and connection errors (SDK default 2). */
  maxRetries?: number;
  /** Inject a client (tests). */
  client?: Anthropic;
}

function normalizeStop(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function toAnthropicMessage(m: ChatTurn): Anthropic.MessageParam {
  if (m.role !== "user" || !m.images?.length) return { role: m.role, content: m.content };
  // Images before the text, as Anthropic recommends for vision prompts.
  return {
    role: "user",
    content: [
      ...m.images.map((img): Anthropic.ImageBlockParam => ({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mimeType,
          data: Buffer.from(img.data).toString("base64"),
        },
      })),
      { type: "text", text: m.content },
    ],
  };
}

/**
 * Anthropic Messages API with structured outputs (`output_config.format` json_schema).
 * The system prompt is a single block marked `cache_control: ephemeral` so the
 * stable prefix (role, rules, layout catalog) is served from the prompt cache.
 */
export function createAnthropicProvider(opts: AnthropicProviderOptions): TextProvider {
  const client =
    opts.client ??
    new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? null,
      maxRetries: opts.maxRetries ?? 2,
    });

  return {
    id: "anthropic",
    async generateObject(req: TextGenerationRequest): Promise<TextGenerationResult> {
      let res: Anthropic.Message;
      try {
        res = await client.messages.create(
          {
            model: req.model,
            max_tokens: req.maxOutputTokens,
            system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
            messages: req.messages.map(toAnthropicMessage),
            output_config: {
              format: { type: "json_schema", schema: toAnthropicSchema(req.jsonSchema) },
              ...(req.effort ? { effort: req.effort } : {}),
            },
          },
          { timeout: req.timeoutMs, ...(req.signal ? { signal: req.signal } : {}) },
        );
      } catch (err) {
        throw classifyError(err, "anthropic");
      }

      const stopReason = normalizeStop(res.stop_reason);
      // Read content only after checking stop_reason: a refusal carries no usable output.
      const text =
        stopReason === "refusal"
          ? ""
          : res.content
              .filter((b): b is Anthropic.TextBlock => b.type === "text")
              .map((b) => b.text)
              .join("");
      const u = res.usage;
      const result: TextGenerationResult = {
        text,
        usage: {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        },
        stopReason,
        rawStopReason: res.stop_reason,
        model: res.model,
      };
      if (stopReason === "refusal") {
        result.refusal =
          res.stop_details?.explanation ??
          `refused (${res.stop_details?.category ?? "unspecified"})`;
      }
      try {
        if (text) result.parsed = JSON.parse(text);
      } catch {
        // Left undefined; the gateway reports it as a validation failure.
      }
      return result;
    },
  };
}
