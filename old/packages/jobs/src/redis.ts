import type { ConnectionOptions } from "bullmq";

/**
 * BullMQ 6 no longer bundles a Redis driver: `ioredis` is an optional peer dependency
 * and is loaded lazily here. Any ioredis-compatible instance can be passed instead.
 */
export type RedisConnection = ConnectionOptions & {
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
};

export interface RedisConnectionOptions {
  /** Workers must use null (blocking commands); producers may fail fast. */
  maxRetriesPerRequest?: number | null;
  connectionName?: string;
}

export async function createRedisConnection(
  url: string,
  options: RedisConnectionOptions = {},
): Promise<RedisConnection> {
  const specifier = "ioredis";
  let mod: { default?: unknown; Redis?: unknown };
  try {
    mod = (await import(/* @vite-ignore */ specifier)) as { default?: unknown; Redis?: unknown };
  } catch {
    throw new Error(
      "@forgecy/jobs requires the 'ioredis' package (BullMQ 6 optional peer). Add it to @forgecy/jobs dependencies.",
    );
  }
  const Redis = (mod.Redis ?? mod.default) as new (
    url: string,
    opts: Record<string, unknown>,
  ) => RedisConnection;
  return new Redis(url, {
    maxRetriesPerRequest:
      options.maxRetriesPerRequest === undefined ? null : options.maxRetriesPerRequest,
    ...(options.connectionName ? { connectionName: options.connectionName } : {}),
  });
}

export async function closeRedisConnection(conn: RedisConnection): Promise<void> {
  try {
    await conn.quit?.();
  } catch {
    conn.disconnect?.();
  }
}
