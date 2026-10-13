# Forgecy — Background AI work and local operation

## What changed

Dossier drafting and campaign missions launched from the active workspace or Leader chat are recorded in `public.ai_jobs` with an authenticated client owner. A protected server worker executes the job later, preserving the already-established dossier approval and campaign proposal gates.

- Queue in PostgreSQL; `forgecy_enqueue_ai_job` is a SECURITY DEFINER RPC that enforces ownership, a maximum of **three** active jobs per client and **24** jobs over 24 hours per client. These are *job-count* budgets, not provider token/currency budgets.
- The client can read only its own jobs and cancel queued ones; it **cannot** set `status=succeeded` or modify worker results.
- `forgecy_claim_ai_job` uses `FOR UPDATE SKIP LOCKED` and a 150-second renewable lease with per-attempt fencing tokens. Expired jobs are retried up to the configured maximum attempts. Two concurrent workers cannot claim the same queued row.
- `ai_job_id` on missions and dossiers prevents duplicate output records after a retry of an already completed operation. A model operation may still incur repeat provider charges if interrupted mid-call.
- The privileged worker validates that `clients.owner_id` equals the job's `requested_by` before creating client-owned records; the service-role key is **never** used in browsers or ordinary CRUD.
- `GET /api/workspace/clients/:id/jobs` lists job history, `POST` enqueues jobs, and `DELETE /api/workspace/clients/:id/jobs/:jobId` cancels **queued** jobs.
- The frontend automatically polls while jobs are queued/running. Completing a campaign produces a proposal requiring human approval.

## Local activation (default)

For personal use, run the app and the sequential local dispatcher in [LOCAL_SETUP.md](LOCAL_SETUP.md#5-run-queued-ai-work-locally). Use your own Supabase project and API keys; no public host or second environment is required. Keep the computer and both processes running.

## Activation and optional hosted scheduling

1. For the current application, apply SQL migrations `0001` through `0018_worker_knowledge_search.sql` in order. Apply the website quota migration 0012 and source-chunk migrations 0013/0014 before 0015.
2. Set `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` and `CRON_SECRET` in the backend environment (the cron secret must have at least 24 characters).
3. Call `GET /api/jobs/dispatch` with `Authorization: Bearer <CRON_SECRET>` from an authenticated **server-side scheduler**. One invocation processes at most one queued job; the endpoint is unavailable when secrets are missing.
4. For **Vercel Pro**, configure a schedule such as `*/5 * * * *` in `vercel.json` for path `/api/jobs/dispatch`. Vercel injects the `Authorization` header when `CRON_SECRET` is set. Vercel **Hobby** limits Cron jobs to daily schedules; do not deploy a 5-minute cron configuration on Hobby. Alternatively invoke the endpoint from an external trusted scheduler with the Bearer token.
5. Use a Node runtime with a maximum function duration of at least 240 seconds, or adapt the runner to shorter task slices. `app/api/jobs/dispatch/route.ts` has `maxDuration=240`; actual limits depend on hosting plan.
6. Smoke-test your personal installation with sample records, a real OpenRouter key, one approved dossier and two competing worker requests. A separate disposable project is optional for risky tests; never run CI SQL fixtures against personal data.

## V19 lease fencing and concurrency guarantees

Apply `0015_ai_worker_fencing.sql` **after** migrations 0012, 0013 and 0014; then apply 0016, 0017 and 0018 for the current app.
Every worker claim now receives a cryptographically random, server-only `lease_token` and a 150-second lease. While working, `runWithJobLease` renews it about every 30 seconds (and at checkpoints before critical writes). Completion and failure use dedicated PostgreSQL RPCs that succeed only when the job is still running **and** the same unexpired lease token is held.

The previous attempt's token is invalidated when the expired job is requeued. A stale worker cannot renew, complete or fail another worker's attempt, even if it knows the job ID. The lease token is excluded from grants to authenticated app users; only the service-role worker may call heartbeat/complete/fail RPCs.

An interrupted worker may already have sent an OpenRouter request before its lease expires: these guards cannot guarantee exactly-once external API billing or undo partial side effects. Dossier and strategy records have unique `ai_job_id` constraints and critical writes check the active lease. Missions still need finer per-agent transactions for full exactly-once behavior. If heartbeats fail because of network/database issues, the worker fails closed and the next dispatcher invocation recovers the expired job. Server scheduling and secrets are still mandatory.

The SQL smoke suite tests stale-token rejection, lease renewal, recovery, exhaustion and service-only privileges; unit tests test a renewal failure during processing. These do **not** replace a real installation test with two independent worker processes and the actual provider.


## Worker evidence retrieval (0018)

Queued jobs use a service-role database client and have no user-session `auth.uid()`. Migration `0018_worker_knowledge_search.sql` supplies a separate service-role-only excerpt search RPC that verifies both the client ID and requesting owner. The worker marks this context only after checking `clients.owner_id`; ordinary authenticated searches retain their existing RLS RPC. Apply 0018 before running the updated worker. Never grant this RPC to browser roles.

## Security and reliability notes

The worker service-role credential bypasses RLS, so its privileges and logs require elevated protections. Jobs only accept known actions, payload sizes are bounded in SQL, and the frontend cannot claim jobs. The renewable lease expires after 150 seconds without a heartbeat. An independent scheduler must continue dispatching jobs, and each worker must finish within the host's execution limit. A longer database lease does not extend the host execution timeout. Use a host with a sufficient execution budget or refactor long AI work into smaller resumable jobs before enabling the worker.

This is a basic durable queue, not a full distributed execution engine with per-stage resumability, exactly-once model billing, streaming, automatic cron deployment, realtime push or token-based spending budgets. V25 includes a partial provider usage ledger; it is not an enforceable currency budget. If a public or larger deployment is desired, evaluate Supabase Queues (pgmq), isolated workers and dead-letter monitoring. These are not prerequisites for a personal local installation.

Documentation: https://supabase.com/docs/guides/queues and https://vercel.com/docs/cron-jobs/quickstart.
