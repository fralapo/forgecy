import type { z } from "zod";
import { checkAiPolicy, ForgecyError, type AiPolicy, type ProviderId } from "@forgecy/core";
import { AiProviderError, classifyError } from "./errors";
import { monthKey, type AiLedger, type BudgetScope, type LedgerEntry } from "./ledger";
import { computeCost } from "./pricing";
import { formatZodIssues, zodToJsonSchema } from "./schema";
import { sha256, summarizeFields } from "./summary";
import {
  addUsage,
  emptyUsage,
  type AiTask,
  type ChatTurn,
  type Effort,
  type GeneratedImage,
  type ImageGenerationStatus,
  type ImageProvider,
  type ImageSize,
  type InputImage,
  type ModelRef,
  type ProviderSet,
  type TextGenerationResult,
  type Usage,
  inputImageMimeTypes,
} from "./types";

/** Max model calls per job for structured output: first try + one retry with the validation error. */
export const MAX_VALIDATION_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_IMAGE_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
/** Images per request. Anthropic accepts more, but beyond this a task should be split. */
export const MAX_INPUT_IMAGES = 20;
/** Raw bytes per image: base64 of 3.75 MB stays under Anthropic's 5 MB per-image limit. */
export const MAX_INPUT_IMAGE_BYTES = 3_750_000;

export interface TaskRoute {
  primary: ModelRef;
  /** Used only for retryable errors or refusals, and only if the client policy allows it. */
  fallback?: ModelRef;
  maxOutputTokens?: number;
  timeoutMs?: number;
  effort?: Effort;
}

export interface Routing {
  default: TaskRoute;
  tasks?: Partial<Record<AiTask, TaskRoute>>;
  image?: TaskRoute;
  /** Text model for local_only clients (Ollama / LM Studio). */
  local?: ModelRef;
  /** Image model for local_only clients (ComfyUI and similar behind an ImageProvider). */
  localImage?: ModelRef;
}

/** Minimal pino-compatible logger. */
export interface GatewayLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
  info?(obj: Record<string, unknown>, msg?: string): void;
}

export interface GatewayOptions {
  ledger: AiLedger;
  providers: ProviderSet;
  routing: Routing;
  logger?: GatewayLogger;
  now?: () => Date;
  imagePollIntervalMs?: number;
}

/** Describes what is sent without sending it to the log: fields are hashed, never stored raw. */
export interface InputSummaryInput {
  fields?: Record<string, string | Uint8Array | null | undefined>;
  assets?: Array<{ id: string; sha256?: string }>;
  meta?: Record<string, string | number | boolean | null>;
}

interface CommonRequest {
  clientId?: string | null;
  clientPolicy: AiPolicy;
  approvedProviders?: readonly ProviderId[];
  authorizedBy?: string | null;
  contentId?: string | null;
  jobId?: string | null;
  inputSummary?: InputSummaryInput;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Per-call override of the configured route. */
  route?: TaskRoute;
}

export interface GenerateObjectRequest<T> extends CommonRequest {
  task: AiTask;
  schema: z.ZodType<T>;
  /** Name given to the schema in provider requests; defaults to the task. */
  schemaName?: string;
  system: string;
  input: string;
  /**
   * Images sent with `input` (vision). Same policy, budget and log as text: the log
   * keeps only hash, size and type of each image. local_only needs a local vision model.
   */
  images?: InputImage[];
  effort?: Effort;
  maxOutputTokens?: number;
}

export interface BudgetWarning {
  scope: "agency" | "client";
  spentMicroUsd: number;
  limitMicroUsd: number;
  percent: number;
}

export interface GenerateObjectResult<T> {
  data: T;
  usage: Usage;
  provider: ProviderId;
  model: string;
  costMicroUsd: number;
  attempts: number;
  fallbackUsed: boolean;
  budgetWarnings: BudgetWarning[];
}

export interface GenerateImageRequest extends CommonRequest {
  prompt: string;
  size: ImageSize;
  variants: 1 | 2 | 3 | 4;
}

export interface GenerateImageResult {
  images: GeneratedImage[];
  usage: Usage;
  provider: ProviderId;
  model: string;
  costMicroUsd: number;
  fallbackUsed: boolean;
  budgetWarnings: BudgetWarning[];
}

export interface AiGateway {
  generateObject<T>(req: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>>;
  generateImage(req: GenerateImageRequest): Promise<GenerateImageResult>;
}

function sniffImage(data: Uint8Array): string | undefined {
  const at = (i: number) => data[i];
  const ascii = (from: number, len: number) =>
    String.fromCharCode(...data.subarray(from, from + len));
  if (at(0) === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  return undefined;
}

/** Rejects images a provider would refuse with a 400, before any policy or budget check. */
export function validateInputImages(images: readonly InputImage[]): void {
  if (images.length > MAX_INPUT_IMAGES) {
    throw new ForgecyError(
      "validation",
      `Too many images (${images.length}); the limit is ${MAX_INPUT_IMAGES} per request`,
    );
  }
  images.forEach((img, index) => {
    if (!(inputImageMimeTypes as readonly string[]).includes(img.mimeType)) {
      throw new ForgecyError("validation", `Image ${index}: unsupported type ${img.mimeType}`, {
        index,
      });
    }
    if (img.data.byteLength === 0 || img.data.byteLength > MAX_INPUT_IMAGE_BYTES) {
      throw new ForgecyError(
        "validation",
        `Image ${index}: ${img.data.byteLength} bytes; allowed 1 to ${MAX_INPUT_IMAGE_BYTES}`,
        { index, bytes: img.data.byteLength },
      );
    }
    const sniffed = sniffImage(img.data);
    if (sniffed !== img.mimeType) {
      throw new ForgecyError(
        "validation",
        `Image ${index}: content is ${sniffed ?? "not a supported image"}, declared ${img.mimeType}`,
        { index },
      );
    }
  });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

export function createAiGateway(opts: GatewayOptions): AiGateway {
  const { ledger, providers, routing, logger } = opts;
  const now = opts.now ?? (() => new Date());
  const pollMs = opts.imagePollIntervalMs ?? 2_000;

  function baseEntry(
    kind: string,
    req: CommonRequest,
  ): Omit<LedgerEntry, "status" | "inputSummary" | "startedAt"> {
    return {
      jobId: req.jobId ?? null,
      kind,
      clientId: req.clientId ?? null,
      contentId: req.contentId ?? null,
      policy: req.clientPolicy,
      authorizedBy: req.authorizedBy ?? null,
      tokensIn: 0,
      tokensOut: 0,
      costMicroUsd: 0,
    };
  }

  /**
   * Policy filter: no_ai blocks everything, local_only only ever sees the local
   * route, external_restricted keeps approved providers. Writes a `blocked`
   * row and throws when nothing is left, so the job never starts.
   */
  async function resolveCandidates(
    kind: string,
    req: CommonRequest,
    route: TaskRoute,
    local: ModelRef | undefined,
    configured: (p: ProviderId) => boolean,
    summary: Record<string, unknown>,
  ): Promise<ModelRef[]> {
    const block = async (reason: string, message: string, model?: ModelRef) => {
      await ledger.record({
        ...baseEntry(kind, req),
        provider: model?.provider ?? null,
        model: model?.model ?? null,
        status: "blocked",
        inputSummary: { ...summary, blockedReason: reason },
        error: message,
        startedAt: now(),
        endedAt: now(),
      });
      throw new ForgecyError("policy_blocked", message, { reason, policy: req.clientPolicy });
    };

    if (req.clientPolicy === "no_ai")
      return block("no_ai", "AI is disabled for this client (policy no_ai)", route.primary);

    let candidates: ModelRef[];
    if (req.clientPolicy === "local_only") {
      const localRef = local ?? (route.primary.provider === "local" ? route.primary : undefined);
      if (!localRef || !configured("local")) {
        // Never fall back to an external provider: stop with a clear error.
        return block(
          "local_unavailable",
          "Client policy is local_only but no local model is configured",
          route.primary,
        );
      }
      candidates = [localRef];
    } else {
      candidates = route.fallback ? [route.primary, route.fallback] : [route.primary];
    }

    const allowed: ModelRef[] = [];
    let firstDenial: string | undefined;
    for (const c of candidates) {
      const decision = checkAiPolicy(req.clientPolicy, c.provider, req.approvedProviders ?? []);
      if (decision.allowed) allowed.push(c);
      else firstDenial ??= decision.reason;
    }
    if (allowed.length === 0) {
      return block(
        firstDenial ?? "policy",
        `Policy ${req.clientPolicy} does not allow provider ${route.primary.provider}`,
        route.primary,
      );
    }
    if (allowed[0] !== candidates[0]) {
      logger?.warn(
        { kind, policy: req.clientPolicy, skipped: candidates[0]?.provider },
        "primary provider not allowed by policy; using fallback",
      );
    }

    const usable = allowed.filter((c) => configured(c.provider));
    if (usable.length === 0) {
      const message = `No configured provider for ${kind} (wanted ${allowed.map((c) => c.provider).join(", ")})`;
      await ledger.record({
        ...baseEntry(kind, req),
        provider: allowed[0]?.provider ?? null,
        model: allowed[0]?.model ?? null,
        status: "error",
        inputSummary: summary,
        error: message,
        startedAt: now(),
        endedAt: now(),
      });
      throw new ForgecyError("unavailable", message);
    }
    return usable;
  }

  /** Month-to-date spend vs budgets for agency and client. Blocks at 100%, warns at warn_at_percent. */
  async function checkBudget(
    kind: string,
    req: CommonRequest,
    first: ModelRef,
    summary: Record<string, unknown>,
  ) {
    const month = monthKey(now());
    const scopes: BudgetScope[] = [{ scope: "agency" }];
    if (req.clientId) scopes.push({ scope: "client", clientId: req.clientId });
    const warnings: BudgetWarning[] = [];
    for (const scope of scopes) {
      const limit = await ledger.budgetFor(scope, month);
      if (!limit) continue;
      const spent = await ledger.monthSpendMicroUsd(scope, month);
      const percent = limit.limitMicroUsd > 0 ? (spent / limit.limitMicroUsd) * 100 : 100;
      if (spent >= limit.limitMicroUsd) {
        const message = `Monthly AI budget exhausted for ${scope.scope} (${percent.toFixed(0)}% of limit)`;
        await ledger.record({
          ...baseEntry(kind, req),
          provider: first.provider,
          model: first.model,
          status: "blocked",
          inputSummary: { ...summary, blockedReason: "budget_exceeded", budgetScope: scope.scope },
          error: message,
          startedAt: now(),
          endedAt: now(),
        });
        throw new ForgecyError("budget_exceeded", message, {
          scope: scope.scope,
          spentMicroUsd: spent,
          limitMicroUsd: limit.limitMicroUsd,
        });
      }
      if (percent >= limit.warnAtPercent) {
        const w: BudgetWarning = {
          scope: scope.scope,
          spentMicroUsd: spent,
          limitMicroUsd: limit.limitMicroUsd,
          percent,
        };
        warnings.push(w);
        logger?.warn(
          { kind, ...w, clientId: req.clientId ?? null },
          "AI budget warning threshold reached",
        );
      }
    }
    return warnings;
  }

  function summarize(
    kind: string,
    req: CommonRequest,
    extra: Record<string, string | Uint8Array>,
  ): Record<string, unknown> {
    const s = req.inputSummary;
    return {
      task: kind,
      fields: summarizeFields({ ...extra, ...(s?.fields ?? {}) }),
      ...(s?.assets?.length ? { assets: s.assets } : {}),
      ...(s?.meta ? { meta: s.meta } : {}),
    };
  }

  return {
    async generateObject<T>(req: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>> {
      const route = req.route ?? routing.tasks?.[req.task] ?? routing.default;
      const jsonSchema = zodToJsonSchema(req.schema);
      const schemaName = req.schemaName ?? req.task;
      const images = req.images ?? [];
      validateInputImages(images);
      const summary = {
        ...summarize(req.task, req, { system: req.system, input: req.input }),
        schema: { name: schemaName, sha256: sha256(JSON.stringify(jsonSchema)) },
        ...(images.length
          ? {
              images: images.map((img) => ({
                ...(img.id ? { id: img.id } : {}),
                sha256: sha256(img.data),
                bytes: img.data.byteLength,
                mimeType: img.mimeType,
              })),
            }
          : {}),
      };
      const candidates = await resolveCandidates(
        req.task,
        req,
        route,
        routing.local,
        (p) => !!providers.text[p],
        summary,
      );
      const budgetWarnings = await checkBudget(req.task, req, candidates[0]!, summary);

      const baseMessages: ChatTurn[] = [
        { role: "user", content: req.input, ...(images.length ? { images } : {}) },
      ];
      let usage = emptyUsage();
      let cost = 0;
      let attempts = 0;
      let validationFailures = 0;

      for (let ci = 0; ci < candidates.length; ci++) {
        const cand = candidates[ci]!;
        const provider = providers.text[cand.provider]!;
        const isFallback = ci > 0;
        const messages = [...baseMessages];

        for (;;) {
          attempts++;
          const startedAt = now();
          const logRow = async (
            status: LedgerEntry["status"],
            res: TextGenerationResult | undefined,
            error?: string,
          ) => {
            const c = res
              ? computeCost(cand.provider, cand.model, res.usage)
              : { costMicroUsd: 0, priced: true };
            if (res) {
              usage = addUsage(usage, res.usage);
              cost += c.costMicroUsd;
            }
            await ledger.record({
              ...baseEntry(req.task, req),
              provider: cand.provider,
              model: res?.model ?? cand.model,
              status,
              inputSummary: {
                ...summary,
                attempt: attempts,
                fallback: isFallback,
                ...(c.priced ? {} : { unpriced: true }),
              },
              tokensIn: res
                ? res.usage.inputTokens + res.usage.cacheReadTokens + res.usage.cacheWriteTokens
                : 0,
              tokensOut: res?.usage.outputTokens ?? 0,
              costMicroUsd: c.costMicroUsd,
              error: error ?? null,
              startedAt,
              endedAt: now(),
            });
            if (!c.priced)
              logger?.warn(
                { provider: cand.provider, model: cand.model },
                "model missing from price table; cost logged as 0",
              );
          };

          let res: TextGenerationResult;
          try {
            res = await provider.generateObject({
              model: cand.model,
              system: req.system,
              messages,
              jsonSchema,
              schemaName,
              maxOutputTokens:
                req.maxOutputTokens ?? route.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
              timeoutMs: req.timeoutMs ?? route.timeoutMs ?? DEFAULT_TIMEOUT_MS,
              ...((req.effort ?? route.effort) ? { effort: (req.effort ?? route.effort)! } : {}),
              ...(req.signal ? { signal: req.signal } : {}),
            });
          } catch (e) {
            const err = classifyError(e, cand.provider);
            await logRow("error", undefined, `${err.kind}: ${err.message}`);
            if (err.fallbackEligible && ci < candidates.length - 1) {
              logger?.warn(
                {
                  task: req.task,
                  from: cand.provider,
                  to: candidates[ci + 1]!.provider,
                  kind: err.kind,
                },
                "AI provider failed; using fallback",
              );
              break;
            }
            throw err;
          }

          // stop_reason first: refusals and truncations are not validation problems.
          if (res.stopReason === "refusal" || res.stopReason === "content_filter") {
            const kind = res.stopReason;
            const message = `${cand.provider} ${kind === "refusal" ? "refused" : "filtered"} the request${res.refusal ? `: ${res.refusal}` : ""}`;
            await logRow("error", res, `${kind}: ${message}`);
            if (ci < candidates.length - 1) {
              logger?.warn(
                { task: req.task, from: cand.provider, to: candidates[ci + 1]!.provider, kind },
                "AI provider refused; using fallback",
              );
              break;
            }
            throw new AiProviderError(kind, message, { provider: cand.provider });
          }
          if (res.stopReason === "max_tokens") {
            const message = `${cand.provider} output truncated at max_tokens; raise maxOutputTokens for task ${req.task}`;
            await logRow("error", res, `max_tokens: ${message}`);
            throw new AiProviderError("max_tokens", message, { provider: cand.provider });
          }

          let feedback: string;
          let parsed = res.parsed;
          if (parsed === undefined) {
            try {
              parsed = JSON.parse(res.text);
            } catch {
              parsed = undefined;
            }
          }
          if (parsed === undefined) {
            feedback = "- (root): output is not valid JSON";
          } else {
            const check = req.schema.safeParse(parsed);
            if (check.success) {
              await logRow("ok", res);
              return {
                data: check.data,
                usage,
                provider: cand.provider,
                model: res.model,
                costMicroUsd: cost,
                attempts,
                fallbackUsed: isFallback,
                budgetWarnings,
              };
            }
            feedback = formatZodIssues(check.error);
          }

          validationFailures++;
          await logRow("error", res, `invalid_output: ${feedback.slice(0, 500)}`);
          if (validationFailures >= MAX_VALIDATION_ATTEMPTS) {
            throw new AiProviderError(
              "invalid_output",
              `AI output for ${req.task} failed validation after ${MAX_VALIDATION_ATTEMPTS} attempts:\n${feedback}`,
              { provider: cand.provider, details: { issues: feedback } },
            );
          }
          if (res.text) messages.push({ role: "assistant", content: res.text });
          messages.push({
            role: "user",
            content: `Your previous output did not match the required JSON schema:\n${feedback}\nReturn the complete corrected JSON object only.`,
          });
        }
      }
      // Unreachable: the last candidate either returns or throws.
      throw new ForgecyError("provider_error", `AI generation for ${req.task} failed`);
    },

    async generateImage(req: GenerateImageRequest): Promise<GenerateImageResult> {
      const kind = "image";
      const route = req.route ?? routing.image;
      if (!route) throw new ForgecyError("unavailable", "No image provider route configured");
      const summary = summarize(kind, req, { prompt: req.prompt });
      Object.assign(summary, { size: req.size, variants: req.variants });
      const candidates = await resolveCandidates(
        kind,
        req,
        route,
        routing.localImage,
        (p) => !!providers.image[p],
        summary,
      );
      const budgetWarnings = await checkBudget(kind, req, candidates[0]!, summary);
      const timeoutMs = req.timeoutMs ?? route.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;

      for (let ci = 0; ci < candidates.length; ci++) {
        const cand = candidates[ci]!;
        const provider = providers.image[cand.provider]!;
        const startedAt = now();
        try {
          const status = await runImageJob(provider, cand, req, timeoutMs);
          const usage = status.usage ?? { ...emptyUsage(), images: status.images?.length ?? 0 };
          const c = computeCost(cand.provider, cand.model, usage);
          await ledger.record({
            ...baseEntry(kind, req),
            provider: cand.provider,
            model: status.model ?? cand.model,
            status: "ok",
            inputSummary: {
              ...summary,
              attempt: ci + 1,
              fallback: ci > 0,
              ...(c.priced ? {} : { unpriced: true }),
            },
            resultRef: status.jobId,
            tokensIn: usage.inputTokens,
            tokensOut: usage.outputTokens,
            costMicroUsd: c.costMicroUsd,
            startedAt,
            endedAt: now(),
          });
          return {
            images: status.images ?? [],
            usage,
            provider: cand.provider,
            model: status.model ?? cand.model,
            costMicroUsd: c.costMicroUsd,
            fallbackUsed: ci > 0,
            budgetWarnings,
          };
        } catch (e) {
          const err = classifyError(e, cand.provider);
          await ledger.record({
            ...baseEntry(kind, req),
            provider: cand.provider,
            model: cand.model,
            status: "error",
            inputSummary: { ...summary, attempt: ci + 1, fallback: ci > 0 },
            error: `${err.kind}: ${err.message}`,
            startedAt,
            endedAt: now(),
          });
          if (err.fallbackEligible && ci < candidates.length - 1) {
            logger?.warn(
              { from: cand.provider, to: candidates[ci + 1]!.provider, kind: err.kind },
              "image provider failed; using fallback",
            );
            continue;
          }
          throw err;
        }
      }
      throw new ForgecyError("provider_error", "Image generation failed");
    },
  };

  async function runImageJob(
    provider: ImageProvider,
    cand: ModelRef,
    req: GenerateImageRequest,
    timeoutMs: number,
  ): Promise<ImageGenerationStatus> {
    const deadline = Date.now() + timeoutMs;
    let status: ImageGenerationStatus = await provider.generate({
      model: cand.model,
      prompt: req.prompt,
      size: req.size,
      variants: req.variants,
      timeoutMs,
      ...(req.signal ? { signal: req.signal } : {}),
    });
    while (status.state === "queued" || status.state === "running") {
      if (Date.now() >= deadline) {
        await provider.cancel?.(status.jobId).catch(() => undefined);
        throw new AiProviderError(
          "timeout",
          `Image job ${status.jobId} timed out after ${timeoutMs} ms`,
          { provider: cand.provider },
        );
      }
      await sleep(pollMs, req.signal);
      status = await provider.getStatus(status.jobId);
    }
    if (status.state !== "succeeded") {
      throw new AiProviderError(
        "unknown",
        `Image job ${status.state}: ${status.error ?? "no details"}`,
        { provider: cand.provider },
      );
    }
    return status;
  }
}
