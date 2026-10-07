# @forgecy/content

Content and carousels (M5): Content Strategy, 30-day plan, carousels with brief, outline, slides, images, review and export.

- **Strategy** (`strategy.ts`): pillars and rubrics with goal, funnel, frequency and linked products; review with `rev` (`CONFLICT-DRAFT-REV`). The Planner (`content.propose_strategy`) saves only proposals with sources and confidence; a person accepts or rejects them.
- **Plan** (`content.propose_plan`): one proposed plan at a time; items are decided one by one and “Activate plan” replaces the active plan. An accepted item gives rise to an already set-up carousel.
- **Carousels** (`carousels/carousels.ts`): they need a published Brand Identity (`BRAND-NOT-PUBLISHED`) and a published template from the catalog. The structured brief adapts to the channel (Instagram 2,200 caption characters, LinkedIn 3,000). Outline (`content.generate_outline`), outline approval, slides (`content.generate_slides`) validated against the template's layouts, editing a slide with an instruction (`content.edit_slide`) with “Keep” or “Undo edit”, slots protected from the AI.
- **Versions**: every generation, save, restore and submission creates an immutable version (trigger `content_versions_immutable`); the draft is saved with `draftRev`.
- **Checks** (`carousels/checks.ts`, also in the browser): template limits, caption, final CTA, hashtags, forbidden words, unrequested prices, unapproved AI images, commercial use to verify, alt text, changed product or Brand Identity.
- **Review**: “Submit for review” requires zero errors; approval requires “Seen” on every warning and a note if you approve your own work. Agents propose, they never approve.
- **Brand Guard** (`carousels/brand-guard.ts`): a port registered by the apps with `setBrandGuard({ run: runBrandCheck, get: getBrandCheck, confirmForApproval: confirmBrandCheckForApproval })`. With the port registered, the carousel is checked on save and on submission, and approval confirms its results in the same transaction. The interface shows the coherence band and the results, never the numeric score.
- **Images** (`assets.ts`, `content.generate_image`): the client's library with content-addressed keys (`clients/<id>/assets/<sha256>.<ext>`). AI images go through the gateway (OpenAI, then Gemini) and stay drafts until a person approves them; a provider with a rejected `commercial_use_status` is excluded, one still to verify produces a warning. Uploaded images carry a rights confirmation (`assets.rights`: basis, note, who, when, set from the library with `confirmAssetRights`); without it the carousel check warns, like an unverified AI provider.
- **Export** (`content.export`, `export` queue): uses the renderer's export with the approved version, the theme from the brand and the pinned template version; the first final export moves the carousel to “Exported”.
- **Products** (`products.ts`): `setProductSource` port for the catalog. `listProductUsage(db, clientId, productId)` lists the pillars, rubrics, plan items and carousels that use a product (the catalog's “Used in” section).

The worker registers `contentHandlers` from `@forgecy/content/handlers`; the browser imports only `@forgecy/content/client`.

Tests: `pnpm --filter @forgecy/content test`; the integration ones run with `FORGECY_TEST_DATABASE_URL`.
