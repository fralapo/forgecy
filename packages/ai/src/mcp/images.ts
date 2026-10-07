import { randomUUID } from "node:crypto";
import type { ProviderId } from "@forgecy/core";
import { AiProviderError } from "../errors";
import type {
  GeneratedImage,
  ImageGenerationInput,
  ImageGenerationStatus,
  ImageProvider,
} from "../types";
import {
  collectUrls,
  downloadImages,
  findString,
  inlineImages,
  nearestOption,
  type McpTool,
  type McpToolCaller,
} from "./client";

/**
 * Image generation through a subscription reached over MCP. Tool names and output shapes
 * are the providers', not a stable API: the adapters read the tool list and input schemas
 * at run time and accept URLs, inline images or a job id to poll. Each variant is a
 * separate run; the gateway polls `getStatus` until every run is done.
 */

type Run =
  | { state: "done"; images: GeneratedImage[] }
  | { state: "failed"; error: string }
  | { state: "polling"; poll: () => Promise<Run> };

interface Job {
  runs: Run[];
  model: string;
}

function createAsyncJobs(provider: ProviderId, max = 100) {
  const jobs = new Map<string, Job>();

  async function advance(jobId: string): Promise<ImageGenerationStatus> {
    const job = jobs.get(jobId);
    if (!job) return { jobId, state: "failed", error: "unknown job id" };
    job.runs = await Promise.all(job.runs.map((r) => (r.state === "polling" ? r.poll() : r)));
    const failed = job.runs.find(
      (r): r is Extract<Run, { state: "failed" }> => r.state === "failed",
    );
    const images = job.runs.flatMap((r) => (r.state === "done" ? r.images : []));
    if (job.runs.some((r) => r.state === "polling"))
      return { jobId, state: "running", model: job.model };
    jobs.delete(jobId);
    if (images.length === 0)
      return { jobId, state: "failed", error: failed?.error ?? `${provider} returned no image` };
    return {
      jobId,
      state: "succeeded",
      images,
      model: job.model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        images: images.length,
      },
    };
  }

  return {
    async start(runs: Run[], model: string) {
      const jobId = randomUUID();
      jobs.set(jobId, { runs, model });
      while (jobs.size > max) {
        const oldest = jobs.keys().next().value;
        if (oldest === undefined) break;
        jobs.delete(oldest);
      }
      return advance(jobId);
    },
    advance,
    drop(jobId: string) {
      jobs.delete(jobId);
    },
  };
}

/** Turn one tool result into a finished run (URLs or inline images) or a job to poll. */
async function settle(
  provider: ProviderId,
  result: unknown,
  timeoutMs: number,
  doFetch: typeof fetch | undefined,
  poll: ((id: string) => Promise<unknown>) | undefined,
): Promise<Run> {
  const inline = inlineImages(result);
  if (inline.length) return { state: "done", images: inline };
  const status = findString(result, /^(status|state)$/i) ?? "";
  if (/fail|error|cancel|reject|nsfw|moderat/i.test(status))
    return {
      state: "failed",
      error: findString(result, /error|reason|message/i) ?? `${provider} job ${status}`,
    };
  const done = !status || /complet|succe|done|finish|ready/i.test(status);
  const urls = done ? collectUrls(result) : [];
  if (urls.length) {
    const images = await downloadImages(urls, provider, timeoutMs, doFetch);
    if (images.length) return { state: "done", images };
  }
  const id = findString(
    result,
    /^(prediction_?ids?|job_?id|generation_?id|request_?id|task_?id|id)$/i,
  );
  // Poll while the job runs, or when a synchronous-looking answer carried only an id.
  if (id && poll && (!done || (!status && !urls.length)))
    return {
      state: "polling",
      poll: async () => settle(provider, await poll(id), timeoutMs, doFetch, poll),
    };
  return { state: "failed", error: `${provider} returned no image and no job to follow` };
}

function propertiesOf(tool: McpTool | undefined): Record<string, Record<string, unknown>> {
  return (tool?.inputSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
}

function enumOf(schema: Record<string, unknown> | undefined): string[] {
  const e = schema?.enum ?? (schema?.items as Record<string, unknown> | undefined)?.enum;
  return Array.isArray(e) ? e.map(String) : [];
}

function missingTool(provider: ProviderId, wanted: string, tools: McpTool[]): AiProviderError {
  return new AiProviderError(
    "not_found",
    `${provider}: MCP tool ${wanted} not found (available: ${tools.map((t) => t.name).join(", ") || "none"})`,
    { provider },
  );
}

// ---- Higgsfield ----

export interface HiggsfieldImageOptions {
  caller: McpToolCaller;
  fetch?: typeof fetch;
}

/** Higgsfield's hosted MCP server: `generate_image`, polled with a status tool if async. */
export function createHiggsfieldImageProvider(opts: HiggsfieldImageOptions): ImageProvider {
  const jobs = createAsyncJobs("higgsfield");
  return {
    id: "higgsfield",
    async generate(input: ImageGenerationInput) {
      const tools = await opts.caller.listTools();
      const tool =
        tools.find((t) => t.name === "generate_image") ??
        tools.find((t) => /image/i.test(t.name) && /generat|creat/i.test(t.name));
      if (!tool) throw missingTool("higgsfield", "generate_image", tools);
      const statusTool = tools.find((t) => /status|result|get_generation/i.test(t.name));
      const props = propertiesOf(tool);
      const args: Record<string, unknown> = { prompt: input.prompt };
      const aspectKey = Object.keys(props).find((k) => /aspect|ratio/i.test(k));
      if (aspectKey) {
        const option = nearestOption(enumOf(props[aspectKey]), input.size);
        args[aspectKey] = option ?? `${input.size.w}:${input.size.h}`;
      }
      if (input.model && "model" in props) args.model = input.model;
      const poll = statusTool
        ? (id: string) => {
            const idKey =
              statusTool.inputSchema?.required?.[0] ??
              Object.keys(propertiesOf(statusTool))[0] ??
              "id";
            return opts.caller.callTool(statusTool.name, { [idKey]: id });
          }
        : undefined;
      const runs: Run[] = [];
      for (let i = 0; i < input.variants; i++) {
        const result = await opts.caller.callTool(tool.name, args);
        runs.push(await settle("higgsfield", result, input.timeoutMs, opts.fetch, poll));
      }
      return jobs.start(runs, input.model || "default");
    },
    getStatus: (jobId) => jobs.advance(jobId),
    async cancel(jobId) {
      jobs.drop(jobId);
    },
  };
}

