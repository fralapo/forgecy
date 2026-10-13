# OpenRouter Model Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each signed-in Forgecy user select current OpenRouter text and image-generation models in Settings, with selections synchronized through that user's Supabase account.

**Architecture:** Add an RLS-protected per-user model-preferences table and authenticated server routes that proxy the uncached OpenRouter catalogs. A workspace Settings view loads and saves model IDs; the existing AI request scope resolves the signed-in user's text model for synchronous and queued work, while the image route uses the saved image model through OpenRouter's Images API.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase/PostgreSQL RLS, OpenRouter REST API, Node test runner, PostgreSQL CI.

---

## File map

- Create `supabase/migrations/0019_user_ai_preferences.sql` for owner-only preferences.
- Create `app/api/workspace/settings/models/route.ts` for authenticated live catalog and preference reads/writes.
- Create `lib/ai-model-settings.ts` for OpenRouter catalog calls, response validation, current request model scope, and preference fallback.
- Modify `lib/ai-usage.ts` to resolve the user's saved text model once when entering an AI usage scope; preserve provider usage storage semantics.
- Modify `lib/ai.ts` to use the scoped text model instead of reading `OPENROUTER_MODEL` directly in three places.
- Modify `app/api/workspace/clients/[clientId]/contents/[contentId]/image/route.ts` to call OpenRouter's image endpoint, validate returned media type/size, store the image, and record OpenRouter usage.
- Create `components/model-settings.tsx` for the Settings content and its live catalog states.
- Modify `components/workspace.tsx` and `components/types.ts` to add Settings to desktop and mobile navigation.
- Modify `.github/workflows/verify-v11.yml` and add `tests/sql/ai-model-settings.sql` so migration and RLS behavior run in CI.
- Add `tests/unit/ai-model-settings.test.ts` and extend usage/image route tests where existing harnesses support isolated dependency injection.
- Update `.env.example`, `README.md`, `docs/LOCAL_SETUP.md`, `docs/IMPLEMENTATION.md`, and `docs/AI_PROVIDER_USAGE.md` to make the OpenRouter image-model setup and migration path clear.

## Task 1: Add the owner-only preference table

**Files:**
- Create `supabase/migrations/0019_user_ai_preferences.sql`
- Modify `tests/sql/bootstrap.sql`
- Modify `.github/workflows/verify-v11.yml`
- Create `tests/sql/ai-model-settings.sql`

- [ ] **Step 1: Add SQL assertions for owner access**

Add a SQL test that creates two auth users, inserts a preference as user A, verifies A can read and update it, verifies user B sees no row, and verifies B cannot insert or update A's row. Use the test suite's existing `SET LOCAL ROLE authenticated` and `request.jwt.claim.sub` pattern.

- [ ] **Step 2: Run the new SQL test before implementing the migration**

Run: `psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai-model-settings.sql`
Expected: FAIL because `public.user_ai_preferences` does not exist.

- [ ] **Step 3: Create the preference migration**

Create a table with `user_id uuid primary key references auth.users(id) on delete cascade`, nullable `text_model` and `image_model` text IDs with bounded lengths, and `updated_at timestamptz not null default now()`. Enable RLS, revoke access from `public` and `anon`, grant `select, insert, update` to `authenticated`, and apply one `FOR ALL` policy with both `USING (auth.uid() = user_id)` and `WITH CHECK (auth.uid() = user_id)`.

- [ ] **Step 4: Register migration 0019 in CI**

Append `psql -v ON_ERROR_STOP=1 -f supabase/migrations/0019_user_ai_preferences.sql` after migration 0018 in `.github/workflows/verify-v11.yml`.

- [ ] **Step 5: Run the SQL test and commit**

Run the SQL test against the disposable PostgreSQL test database.
Expected: PASS for both owners and cross-owner denial.
Commit the migration and SQL test with `feat: add per-user AI model preferences`.

## Task 2: Build live OpenRouter model and preference server APIs

**Files:**
- Create `lib/ai-model-settings.ts`
- Create `app/api/workspace/settings/models/route.ts`
- Create `tests/unit/ai-model-settings.test.ts`

- [ ] **Step 1: Test catalog filtering and response validation**

Test that text models are read from `/api/v1/models?output_modalities=text`, image models from `/api/v1/images/models`, malformed entries are discarded, IDs remain intact, and `structured_outputs` capability is exposed for text models. Inject a fetch function so tests never contact OpenRouter.

- [ ] **Step 2: Test preference resolution fallback**

Test that a scoped user preference wins, `OPENROUTER_MODEL` is next, and `openai/gpt-4.1-mini` is the final text fallback. Verify the scope restores the prior value after a rejected request.

- [ ] **Step 3: Implement catalog helpers and request model scope**

In `lib/ai-model-settings.ts`, define typed normalized catalog entries and functions to load both uncached OpenRouter lists with the server-only `OPENROUTER_API_KEY`, a 15-second timeout, and safe error handling. Define an `AsyncLocalStorage<string>` text-model scope plus an exported getter that defaults to `process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini"`.

- [ ] **Step 4: Implement authenticated GET and PATCH routes**

`GET /api/workspace/settings/models` must call `auth()`, fetch current catalogs without cache, read the current user's preference row through `ctx.db`, and return `{ textModels, imageModels, preferences }`. `PATCH` must accept exactly `{ kind: "text" | "image", modelId: string }`, call `auth()`, validate the ID against the corresponding current catalog, then upsert only that user's ID and `updated_at`. Never return provider credentials or raw upstream errors.

- [ ] **Step 5: Run targeted tests and commit**

Run: `npx tsx --test tests/unit/ai-model-settings.test.ts`
Expected: PASS without network access.
Commit with `feat: proxy live OpenRouter model catalogs`.

## Task 3: Route all text AI work through the per-user selection

**Files:**
- Modify `lib/ai-usage.ts`
- Modify `lib/ai.ts`
- Modify `app/api/workspace/[...parts]/route.ts`
- Extend `tests/unit/ai-model-settings.test.ts`

- [ ] **Step 1: Add a failing test for user-scoped model selection**

Run two asynchronous scopes with different text model IDs and verify nested model calls observe only their own model ID; verify a thrown request does not leak its model to later requests.

- [ ] **Step 2: Resolve preferences at the existing AI usage boundary**

Extend `withAiUsageScope` to read `text_model` for `scope.requestedBy` once through the server-only worker database client, then enter the text-model `AsyncLocalStorage` scope around the work:

```ts
const { data, error } = await workerDb()
  .from("user_ai_preferences")
  .select("text_model")
  .eq("user_id", scope.requestedBy)
  .maybeSingle();
```

If the worker key is unavailable, use the existing environment/default fallback. If the preference table read fails after migration deployment, fail the AI operation with a safe setup error rather than silently using another user's value.

- [ ] **Step 3: Replace environment reads in all text requests**

Change all three request bodies and usage model labels in `lib/ai.ts` to use the scoped getter. Preserve the existing timeout, response format, provider routing and usage behavior. Confirm every model call found by `rg -n "modelText\\(|modelJson\\(|modelStructuredJson\\(" app lib` is enclosed by `withAiUsageScope`.

- [ ] **Step 4: Run text/model scope and existing AI tests**

Run: `npx tsx --test tests/unit/ai-model-settings.test.ts tests/unit/structured-dossier.test.ts`
Expected: PASS; tests without a selected preference continue to use the environment/default model.

- [ ] **Step 5: Commit**

Commit with `feat: apply per-user OpenRouter text model`.

## Task 4: Use OpenRouter for image generation

**Files:**
- Modify `app/api/workspace/clients/[clientId]/contents/[contentId]/image/route.ts`
- Modify `lib/ai-usage.ts` only if response usage parsing needs a narrowly scoped compatibility change
- Add focused tests in `tests/unit/ai-model-settings.test.ts` or the existing image-route test file

- [ ] **Step 1: Add failing response normalization tests**

Test supported image media types, rejected unknown types, invalid base64, the 15 MB ceiling, and provider-reported `usage.cost` extraction. Ensure image data is never printed in test failure messages.

- [ ] **Step 2: Read the authenticated image model and preserve current guards**

Read the current user's `image_model` using `ctx.db` after authentication. If it is absent, return an actionable 409 directing the user to Settings. Keep `requireClient`, content ownership/revision checks, prompt construction, and `reserveAiRequest` in place.

- [ ] **Step 3: Replace direct OpenAI call with OpenRouter Images API**

POST `{ model, prompt, aspect_ratio }` to `https://openrouter.ai/api/v1/images` using the server-only OpenRouter key and an 85-second timeout. Use `4:5` for Instagram and `16:9` for LinkedIn. Parse `data[0].b64_json`, validate `data[0].media_type` against PNG/JPEG/WebP, choose the correct extension/content type, and enforce the current 15 MB storage limit.

- [ ] **Step 4: Record provider usage and preserve optimistic save**

Place `recordAiProviderUsage("openrouter", model, payload)` inside the existing image usage scope, preserve private storage upload, revision-guarded content update, cleanup after conflicts, and audit event. Ensure ledger persistence stays best-effort and does not repeat the image request.

- [ ] **Step 5: Run targeted tests and commit**

Run focused image and usage tests.
Expected: PASS for media handling, storage metadata and reported image cost.
Commit with `feat: generate content images through OpenRouter`.

## Task 5: Add the Settings view and selectors

**Files:**
- Create `components/model-settings.tsx`
- Modify `components/types.ts`
- Modify `components/workspace.tsx`
- Modify the relevant mobile navigation rules in `app/globals.css` if six navigation items need a narrower layout

- [ ] **Step 1: Implement the settings form states**

The component loads `/api/workspace/settings/models` on mount, displays distinct text/image selectors, marks structured-output support for text models, displays a saved ID as unavailable when absent from the catalog, and has an explicit refresh button. Selecting a model PATCHes `{ kind, modelId }`; pending, success and error states remain visible and do not discard the prior selection on failure.

- [ ] **Step 2: Add Settings to desktop navigation and render the view**

Add `settings` to the `View` union, add a Settings sidebar item using the existing `Settings2` icon, and render `ModelSettings` when selected. Do not couple the setting to the active client.

- [ ] **Step 3: Make Settings reachable on mobile**

Add Settings to mobile bottom navigation and set the six-column grid so all items remain tappable. Verify no horizontal overflow at 320 px and tablet widths.

- [ ] **Step 4: Run typecheck and inspect the browser UI**

Run `npm run typecheck`. Open the local app, confirm the catalog and preferences load, change each selector, refresh, and confirm the selection persists after reauthentication. Simulate an upstream failure and verify the selected values remain intact.

- [ ] **Step 5: Commit**

Commit with `feat: add in-app OpenRouter model settings`.

## Task 6: Update install documentation and verify the complete change

**Files:**
- Modify `.env.example`
- Modify `README.md`
- Modify `docs/LOCAL_SETUP.md`
- Modify `docs/IMPLEMENTATION.md`
- Modify `docs/AI_PROVIDER_USAGE.md`

- [ ] **Step 1: Document migration and OpenRouter image configuration**

Update migration counts and setup commands to include 0019. Explain that text and image model IDs are chosen in Settings, each local installation needs its own server-only OpenRouter API key, catalog lists are fetched live, and saved choices sync per user through Supabase. Remove `OPENAI_API_KEY` and `OPENAI_IMAGE_MODEL` from the example configuration and describe their removal from image generation.

- [ ] **Step 2: Document provider usage behavior**

Update the integration and usage docs so image generation is attributed to OpenRouter and costs are recorded only when reported by OpenRouter. Keep the distinction between observed usage and a guaranteed invoice/spending cap.

- [ ] **Step 3: Run all repository checks**

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Run the SQL migration/RLS test through the normal CI bootstrap. Fix all regressions caused by this change; retain only pre-existing lint warnings if present.

- [ ] **Step 4: Review the final diff and commit documentation**

Run `git diff --check`, inspect all changed files, and confirm `.env.local` and API keys are absent from the diff. Commit with `docs: update OpenRouter model setup`.

## Handoff decision

The user authorized autonomous inline execution. Do not dispatch subagents. Execute the tasks in order on branch `codex/openrouter-model-settings`, using the checkpoints above and keeping each commit scoped to its task.
