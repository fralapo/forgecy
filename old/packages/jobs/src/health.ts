import { jobQueues, type JobQueueName } from "./registry";
import type { JobQueues } from "./queues";

export interface QueueHealth {
  name: JobQueueName;
  /** Worker processes connected to this queue right now. */
  workers: number;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

/** Live view of every BullMQ queue (System health page). Throws when Redis is unreachable. */
export async function queueHealth(queues: JobQueues): Promise<QueueHealth[]> {
  return Promise.all(
    jobQueues.map(async (name) => {
      const q = queues.get(name);
      const [workers, counts] = await Promise.all([
        q.getWorkersCount(),
        q.getJobCounts("waiting", "active", "delayed", "failed"),
      ]);
      return {
        name,
        workers,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
      };
    }),
  );
}

export interface RedisInfo {
  version: string | null;
  usedMemoryBytes: number | null;
  latencyMs: number;
}

interface PingableRedis {
  ping(): Promise<unknown>;
  info(): Promise<string>;
}

/** Null when the queues were built without a reachable ioredis connection. */
export async function redisInfo(queues: JobQueues): Promise<RedisInfo | null> {
  const client = queues.connection as Partial<PingableRedis> | undefined;
  if (!client?.ping || !client.info) return null;
  const started = performance.now();
  await client.ping.call(client);
  const latencyMs = performance.now() - started;
  const info = await client.info.call(client);
  const field = (k: string) => new RegExp(`^${k}:(.+)$`, "m").exec(info)?.[1]?.trim() ?? null;
  const mem = field("used_memory");
  return { version: field("redis_version"), usedMemoryBytes: mem ? Number(mem) : null, latencyMs };
}
