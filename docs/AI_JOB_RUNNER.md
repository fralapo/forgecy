# Forgecy V15 — Background AI work and operational setup

## What changed

Dossier drafting and campaign missions launched from the active workspace or Leader chat are recorded in `public.ai_jobs` with an authenticated client owner. A protected server worker executes the job later, preserving the already-established dossier approval and campaign proposal gates.

- Queue in PostgreSQL; `forgecy_enqueue_ai_job` is a SECURITY DEFINER RPC that enforces ownership, a maximum of **three** active jobs per client and **24** jobs over 24 hours per client. These are *job-count* budgets, not provider token/currency budgets.
- The client can read only its own jobs and cancel queued ones; it **cannot** set `status=succeeded` or modify worker results.
- `forgecy_claim_ai_job` uses `FOR UPDATE SKIP LOCKED`, leases one job for four minutes and retries expired leases up to two attempts. Two concurrent workers cannot claim the same queued row.
- `ai_job_id` on missions and dossiers prevents duplicate output records after a retry of an already completed operation. A model operation may still incur repeat provider charges if interrupted mid-call.
- The privileged worker validates that `clients.owner_id` equals the job's `requested_by` before creating client-owned records; the service-role key is **never** used in browsers or ordinary CRUD.
- `GET /api/workspace/clients/:id/jobs` lists job history, `POST` enqueues jobs, and `DELETE /api/workspace/clients/:id/jobs/:jobId` cancels **queued** jobs.
- The frontend automatically polls while jobs are queued/running. Completing a campaign produces a proposal requiring human approval.

## Activation (not automatic)

1. Apply SQL migrations `0001`–`0008_ai_jobs.sql` in order.
2. Set `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` and `CRON_SECRET` in the backend environment (the cron secret must have at least 24 characters).
3. Call `GET /api/jobs/dispatch` with `Authorization: Bearer <CRON_SECRET>` from an authenticated **server-side scheduler**. One invocation processes at most one queued job; the endpoint is unavailable when secrets are missing.
4. For **Vercel Pro**, configure a schedule such as `*/5 * * * *` in `vercel.json` for path `/api/jobs/dispatch`. Vercel injects the `Authorization` header when `CRON_SECRET` is set. Vercel **Hobby** limits Cron jobs to daily schedules; do not deploy a 5-minute cron configuration on Hobby. Alternatively invoke the endpoint from an external trusted scheduler with the Bearer token.
5. Use a Node runtime with a maximum function duration of at least 240 seconds, or adapt the runner to shorter task slices. `app/api/jobs/dispatch/route.ts` has `maxDuration=240`; actual limits depend on hosting plan.
6. Smoke-test in a non-production Supabase project with a real OpenRouter key, one approved dossier and two competing worker requests.

## Security and reliability notes

The worker service-role credential bypasses RLS, so its privileges and logs require elevated protections. Jobs only accept known actions, payload sizes are bounded in SQL, and the frontend cannot claim jobs. The lease expires after four minutes. Deployments that cannot guarantee a 4-minute execution budget should increase that lease or refactor long AI work into smaller jobs before enabling the worker.

This is a basic durable queue, not a full distributed execution engine with per-stage resumability, exactly-once model billing, streaming, automatic cron deployment, realtime push or token-based spending budgets. Long-term production recommendations: use Supabase Queues (pgmq), isolated workers, a cost ledger, and dead-letter monitoring when scaling beyond single-job dispatches.

Documentation: https://supabase.com/docs/guides/queues and https://vercel.com/docs/cron-jobs/quickstart.
