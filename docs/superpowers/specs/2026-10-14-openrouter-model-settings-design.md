# OpenRouter model settings design

## Goal

Let each authenticated Forgecy user choose the OpenRouter text model and image-generation model from the app. Show current OpenRouter catalogs instead of maintaining a hard-coded list, and keep the choices synchronized for that user across computers connected to the same Supabase project.

## Current behavior

- Text requests in `lib/ai.ts` use the server environment variable `OPENROUTER_MODEL`, falling back to `openai/gpt-4.1-mini`.
- Image generation calls OpenAI directly, using `OPENAI_API_KEY` and `OPENAI_IMAGE_MODEL`.
- The workspace has no settings view, although its navigation imports a settings icon.
- AI provider usage supports OpenRouter and OpenAI, including provider-reported token and cost fields.

## Approaches considered

1. **Per-user Supabase preferences (selected).** Store model IDs against the authenticated user with row-level security. This adds a small migration and makes selections follow the user across computers.
2. **Browser storage.** Avoids a database migration, but each computer would need its own selection and the setting would be lost when browser storage is cleared.
3. **Environment-only configuration.** Fits server deployments but does not provide in-app selection or live catalogs.

## User experience

- Add an **Impostazioni** item to the existing workspace sidebar and a dedicated settings view.
- Provide separate selectors for **Modello testo** and **Modello immagini**.
- Fetch the text catalog from OpenRouter's `GET /api/v1/models?output_modalities=text` and the image catalog from `GET /api/v1/images/models` whenever the settings view is opened. Requests are uncached. Provide an explicit refresh action so the user can reload both lists without navigating away.
- Display each model's name and ID. In the text selector, mark whether OpenRouter advertises structured-output support. Keep all text-output models selectable; show a clear compatibility note because dossiers and other workflows use structured JSON responses.
- Show loading, empty, and provider/network error states. A catalog failure must not erase or change a saved selection.
- Load the signed-in user's saved selections when the view opens. Save a changed selection through an authenticated server endpoint and report whether it succeeded.
- When a saved model no longer appears in the live catalog, retain and display its ID as unavailable, and ask the user to select a current model. Do not silently replace it.

“Live” means fetched fresh from OpenRouter on view entry or explicit refresh. It does not mean a continuously polled or push-updated list while the page stays open.

## Server and data flow

1. The browser requests the app's authenticated model-catalog endpoint.
2. The server reads `OPENROUTER_API_KEY` and proxies requests to the two official OpenRouter catalog endpoints. The key never reaches the browser, Supabase, or a URL. Use bounded timeouts, `cache: no-store`, and safe user-facing errors.
3. On selection, the browser sends only the model ID and model kind to an authenticated preference endpoint.
4. The endpoint validates the ID against the corresponding live catalog before saving, and writes only the model ID and timestamp for the authenticated user.
5. Text generation reads that user's saved text model, falling back to `OPENROUTER_MODEL` and then the existing default when no preference exists.
6. Image generation reads that user's saved image model. It uses `OPENROUTER_API_KEY` and `POST /api/v1/images`, preserving Forgecy's existing prompt, client authorization, request budget, optimistic content revision check, private asset storage, and audit event.

The image request uses a portrait 4:5 aspect ratio for Instagram and landscape 16:9 for LinkedIn when that ratio is advertised by the selected model; otherwise it omits the ratio and lets the model use its default. Read `data[0].b64_json` and `data[0].media_type`, allow only supported image media types, derive the stored extension from the validated type, and enforce the existing maximum asset size. Record image usage as provider `openrouter`, including reported cost when OpenRouter supplies it. No OpenAI image key is required after the change.

## Preferences and access control

Add migration `0019_user_ai_preferences.sql` with one row per `auth.users` user, nullable `text_model` and `image_model` IDs, and `updated_at`. Enable RLS, grant authenticated users access only to their own row, and enforce ownership with `auth.uid() = user_id`. The API uses the request's authenticated Supabase client; it does not need the service-role key for settings reads or writes. The table contains no credentials, prompts, generated content, or client data.

Before a user has saved preferences, text behavior remains compatible with existing `OPENROUTER_MODEL` configuration and its current default. The image model must be chosen in Settings before image generation; if there is no saved image model, return an actionable error directing the user to Settings. Keep `OPENAI_API_KEY` and `OPENAI_IMAGE_MODEL` out of new runtime code and update setup documentation and `.env.example` accordingly.

## Failure behavior and compatibility

- Missing OpenRouter API key: catalog and AI calls return an actionable configuration error; no key is exposed to client code.
- OpenRouter catalog timeout or error: keep saved preferences intact and let the user retry.
- Model removed between refresh and generation: surface OpenRouter's failure without silently switching models.
- A selected text model without structured-output support can still handle text-only operations. Structured workflows retain their existing strict behavior and may fail with a useful model-compatibility error; the UI warns before selection.
- Provider usage remains best-effort and must never retry a billable generation just because ledger persistence failed.
- Existing users need migration 0019 before deploying the new preferences API. Their text model continues to use the existing environment fallback; they choose an image model once in Settings.

## Validation

- SQL tests cover own-row insert/read/update and reject cross-user access.
- Route tests cover authentication, catalog filtering and shape validation, upstream errors/timeouts, live-ID validation, and preference isolation.
- Unit tests cover preference fallback, unavailable saved models, OpenRouter image response media type and size handling, and usage parsing for image cost.
- UI verification covers loading and retry states, model selection/save feedback, unavailable saved models, responsive sidebar access, and confirmation that catalog/API secrets are not sent to the browser.
- Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; update migration setup instructions, `.env.example`, `README.md`, `docs/LOCAL_SETUP.md`, `docs/IMPLEMENTATION.md`, and provider-usage docs.

## Scope boundaries

- The setting is per authenticated Supabase user, not per client workspace or shared between different users.
- This feature does not add support for configuring or storing OpenRouter credentials in the UI; each local installation configures its own server-only `OPENROUTER_API_KEY`.
- This feature does not provide continuous catalog polling, provider-specific image controls, model benchmarking, or a spending cap.
