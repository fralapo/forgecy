# Worker Knowledge Retrieval Implementation Plan

> Execute inline using the TDD red-green-refactor workflow; no delegated implementation is needed.

**Goal:** Restore queued dossier generation while preserving client ownership and browser RLS.

**Architecture:** A new service-role-only RPC checks the requested client owner and searches bounded ready-source chunks. An internal worker context marker selects it; user contexts retain the existing invoker/RLS RPC.

**Tech Stack:** TypeScript, Supabase/PostgreSQL, Node test runner, GitHub Actions.

- [x] Add one routing regression in `tests/unit/knowledge-search.test.ts`: a context marked with `workerRequestedBy` must call `forgecy_worker_search_client_sources` with `p_requested_by`. Run `npx tsx --test tests/unit/knowledge-search.test.ts` and verify failure on the old RPC name.
- [x] Extend `Context` in `lib/http.ts`, mark the checked worker context in `lib/job-runner.ts`, and route retrieval in `lib/knowledge-search.ts`. Re-run the focused test; keep normal session routing unchanged.
- [x] Add `0018_worker_knowledge_search.sql`: SECURITY INVOKER, service-role-only execute grant, explicit client-owner check, 2–200-character query, 1–20 results and the existing chunk result contract.
- [x] Add SQL worker search cases to the disposable CI suite: own-owner success, mismatched-owner rejection, null/oversized inputs and authenticated/anonymous denial. Add migration/test commands to the existing workflow.
- [x] Update installation references from 0017 to 0018, explain the worker RPC and run typecheck, lint, all Node tests, build and SQL CI. Check links and private-key exclusion.
- [x] Apply only migration 0018 to the initialized personal project, rebuild/restart locally and rerun the real-provider sample flow; remove temporary accounts, records and files. Publish the fix through a green PR.
