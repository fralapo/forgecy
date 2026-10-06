import { z } from "zod";

/** BullMQ queues. Split by workload so slow exports never starve AI calls. */
export const jobQueues = ["default", "ai", "export", "media"] as const;
export type JobQueueName = (typeof jobQueues)[number];

export interface JobDefinition<S extends z.ZodType = z.ZodType, K extends string = string> {
  /** Dotted name, e.g. "content.generate_outline". Stored in jobs.kind. */
  kind: K;
  queue: JobQueueName;
  payload: S;
}

export type AnyJobDefinition = JobDefinition<z.ZodType, string>;
export type JobPayload<D extends AnyJobDefinition> = z.output<D["payload"]>;
export type JobPayloadInput<D extends AnyJobDefinition> = z.input<D["payload"]>;

const KIND = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const registry = new Map<string, AnyJobDefinition>();

/**
 * Central registry, filled by `defineJob` calls at import time. Each module keeps its
 * jobs in its own file; both the web app (enqueue) and the worker (handle) import it.
 */
export const jobDefinitions: ReadonlyMap<string, AnyJobDefinition> = registry;

export function defineJob<S extends z.ZodType, K extends string>(
  def: JobDefinition<S, K>,
): JobDefinition<S, K> {
  if (!KIND.test(def.kind))
    throw new Error(`Invalid job kind "${def.kind}" (expected e.g. "module.action")`);
  if (!(jobQueues as readonly string[]).includes(def.queue))
    throw new Error(`Unknown queue "${def.queue}"`);
  const existing = registry.get(def.kind);
  if (existing && existing !== def) throw new Error(`Job kind "${def.kind}" is already defined`);
  registry.set(def.kind, def);
  return def;
}

export function getJobDefinition(kind: string): AnyJobDefinition {
  const def = registry.get(kind);
  if (!def) throw new Error(`Unknown job kind "${kind}"`);
  return def;
}

/** M1 smoke-test job: the worker echoes the message back as the result. */
export const systemPingJob = defineJob({
  kind: "system.ping",
  queue: "default",
  payload: z.object({ message: z.string().max(500) }),
});
