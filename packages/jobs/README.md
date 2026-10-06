# @forgecy/jobs

Job in background: BullMQ sposta il lavoro, la tabella `jobs` in Postgres è la fonte di verità che l'interfaccia legge.

## Definire un job

Ogni modulo definisce i suoi job in un proprio file, importato sia dall'app web sia dal worker:

```ts
export const outlineJob = defineJob({
  kind: "content.generate_outline",
  queue: "ai",
  payload: z.object({ contentId: z.uuid() }),
});
```

Code: `default`, `ai`, `export`, `media`. Il job `system.ping` (payload `{ message }`) serve per gli smoke test.

## Accodare

`enqueueJob(db, queues, { kind, payload, clientId?, entity?, entityId?, createdBy?, dependsOnJobId? })` valida il payload, inserisce la riga (`queued`) e aggiunge il job BullMQ con `jobId` = id della riga, 3 tentativi e attesa 0 s / 5 s / 30 s. In Redis va solo il `kind`; il payload resta in Postgres. `cancelJob` annulla.

## Worker

`createJobWorker({ db, redisUrl, handlers, concurrency, logger })`, con `handlers` costruiti da `handle(def, async (payload, ctx) => result)`. Il contesto offre `ctx.progress(n)`, `ctx.heartbeat()`, `ctx.isCancelled()`. Stati: `running` → `completed` (con risultato) oppure `retrying` → `failed`. Una `NeedsAttentionError` porta subito a `needs_attention` senza altri tentativi; una `UnrecoverableError` porta subito a `failed`. `close()` chiude in modo ordinato (da chiamare su SIGTERM).

`recoverStaleJobs(db, olderThanMs, { queues })` rimette in `retrying` (o `failed`, se i tentativi sono finiti) i job `running` fermi da più del TTL del lock (10 min). Va eseguita all'avvio del worker e poi periodicamente.

## Lock sul contenuto

`acquireLock(db, { table, id, jobId, ttlMs })` esegue un solo `UPDATE … WHERE locked_by_job_id IS NULL OR lock_expires_at < now()` (rientrante per lo stesso job). Ci sono anche `renewLock`, `releaseLock` e `withLock`, che rinnova il lock ogni ttl/3 e lo rilascia anche in caso di errore. La tabella deve avere le colonne `locked_by_job_id` e `lock_expires_at`.

## SSE

`subscribeJobEvents(db, jobId, { signal })` è un iteratore asincrono che interroga la riga ogni secondo e restituisce un evento a ogni cambio di stato o progresso, fino allo stato terminale. La route SSE web (`GET /api/jobs/:id/events`) lo usa direttamente.

## Redis

BullMQ 6 non include più un driver Redis: serve `ioredis` come dipendenza (caricato in modo lazy da `createRedisConnection`).

Test di integrazione: `FORGECY_TEST_DATABASE_URL=… FORGECY_TEST_REDIS_URL=… pnpm test`.
