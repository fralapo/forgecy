# Worker knowledge retrieval

The live personal-installation smoke test exposed a failure before dossier generation: a service-role worker invokes `forgecy_search_client_sources`, whose ownership check depends on `auth.uid()` and whose execution grant is restricted to authenticated users. A worker has no user's session JWT.

The repair preserves the user-facing RPC and adds a separate service-role-only search RPC in migration 0018. It accepts the client and requesting owner, checks the database client owner, validates bounded search inputs and returns the same ready-source excerpt contract. The worker marks its internal context only after validating the queued job's owner; retrieval selects the private RPC for that context. Browser requests cannot set this marker.

Granting the existing user RPC to the service role alone would not fix its `auth.uid()` check. Weakening that check or copying broad privileged searches into application code would make ownership less explicit. A dedicated checked RPC keeps the two trust boundaries inspectable.

Acceptance: authenticated retrieval keeps its existing contract; worker retrieval succeeds for the checked owner, fails for another owner and cannot be invoked by authenticated/anonymous users. SQL and unit regression tests cover these cases, then the real local dossier/strategy/mission smoke test is rerun. The fix does not enable crawling or publish any content.
