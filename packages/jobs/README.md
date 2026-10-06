# @forgecy/jobs

Background jobs: BullMQ moves the work, the `jobs` table in Postgres is the source of truth the interface reads.

## Defining a job

Each module defines its jobs in its own file, imported by both the web app and the worker:

```ts
export const outlineJob = defineJob({
  kind: "content.generate_outline",
  queue: "ai",
  payload: z.object({ contentId: z.uuid() }),
});
```

Queues: `default`, `ai`, `export`, `media`. The `system.ping` job (payload `{ message }`) is for smoke tests.

## Enqueuing

`enqueueJob(db, queues, { kind, payload, clientId?, entity?, entityId?, createdBy?, dependsOnJobId? })` validates the payload, inserts the row (`queued`) and adds the BullMQ job with `jobId` = row id, 3 attempts and waits of 0 s / 5 s / 30 s. Only the `kind` goes to Redis; the payload stays in Postgres. `cancelJob` cancels.

## Worker

`createJobWorker({ db, redisUrl, handlers, concurrency, logger })`, with `handlers` built by `handle(def, async (payload, ctx) => result)`. The context offers `ctx.progress(n)`, `ctx.heartbeat()`, `ctx.isCancelled()`. States: `running` → `completed` (with a result) or `retrying` → `failed`. A `NeedsAttentionError` leads straight to `needs_attention` with no further attempts; an `UnrecoverableError` leads straight to `failed`. `close()` shuts down cleanly (call it on SIGTERM).

`recoverStaleJobs(db, olderThanMs, { queues })` puts `running` jobs stuck for longer than the lock TTL (10 min) back into `retrying` (or `failed`, if attempts are exhausted). Run it when the worker starts and then periodically.

## Content lock

`acquireLock(db, { table, id, jobId, ttlMs })` runs a single `UPDATE … WHERE locked_by_job_id IS NULL OR lock_expires_at < now()` (reentrant for the same job). There are also `renewLock`, `releaseLock` and `withLock`, which renews the lock every ttl/3 and releases it even on error. The table must have the `locked_by_job_id` and `lock_expires_at` columns.

## SSE

`subscribeJobEvents(db, jobId, { signal })` is an async iterator that polls the row every second and yields an event on every state or progress change, until the terminal state. The web SSE route (`GET /api/jobs/:id/events`) uses it directly.

## Redis

BullMQ 6 no longer bundles a Redis driver: `ioredis` is required as a dependency (loaded lazily by `createRedisConnection`).

Integration tests: `FORGECY_TEST_DATABASE_URL=… FORGECY_TEST_REDIS_URL=… pnpm test`.
