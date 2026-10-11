# 0025 · Ideas taken from the agency's carousel "factories"

- Status: accepted
- Date: 2026-10-11
- Refines: the content and carousel pipeline (static only, the AI never writes HTML, people approve), [0024](0024-carousel-ideas-from-open-source.md)

## Context

Two internal carousel "factories" and one client folder were read: `fabbriche` (nonabboccare), `fabbrica-caroselli` (Magnet) and a client's brand and strategy folder. They are scripts and rule files built around one brand each. Forgecy already has the stronger core (templates with slots, sanitising, per-format safe zones, Brand Guard, human approval, AI only through `packages/ai`). What the factories have that Forgecy lacked is craft: typography rules, copy lint, a stricter brief, a fact bank, and a reviewer that looks at the result. Rules that were one brand's taste stay out, or become per-brand settings.

Constraints that did not move: the AI never writes HTML, agents propose and people approve, no video, no model-given numeric score, free and open-source dependencies only, every string in `packages/i18n` (en and it).

## Decision

### Taken as deterministic checks (pure, typed, tested)

- **Typography on the rendered slide** (`packages/carousel`, `typography/`): widow (last line is one short word), bad line end (line ends on an article, preposition or conjunction), dense block (more than 7 lines), and a **24px font floor**. Function-word lists are data per locale (it, en). These run on carousels only, not on dense report pages.
- **Non-breaking ligature** in the renderer: a space after a function word becomes a no-break space in the rendered HTML only; the stored text never changes.
- **AI-tells lint** (`copy-lint.ts`, patterns per language in `copy-patterns.ts`): dash used as a pause, "not just X, it's Y", press-release words, hanging gerunds, filler phrases, generic optimistic closers. Warnings by default; the em-dash habit is a house voice, so it stays a warning and a brand can choose its own severity.
- **Placeholders** (`[da confermare]`, TODO, TBD, lorem ipsum, `{{x}}`, XXX) in a slide or the caption are errors: they belong in notes.
- **Caption checks**: exactly three hashtags on Instagram (warning), the credit line before the hashtags when stock credits exist.
- **Rhythm**: a warning for four or more dense body slides in a row.
- **Person consistency**: Italian tu/voi, and now English you/we, against the brand's writing rules (`person`). "Lei", "tu" and "voi" read as "you", "noi" as "we"; the impersonal form is not checked. Warning `voice:*`.
- **Cover safe corner** (Brand Guard): the top-right 120x120 of a cover stays free of text (Instagram draws the carousel icon there), the bottom zone holds only pagination, and margins stay at least 80px.

### Taken as templates

- **Eight layouts** in `editorial-ig-4x5` and `editorial-linkedin` (version 1.4.0, en and it samples, validated): `breather`, `evidence` (chat or mail card with a detail circle), `takeaway` ("Tradotto:" box), `steps` (numbered), `cover-photo` (with scrim), `cover-statement` (typographic), `cta-single` and `cta-conclusion` (no action).
- **`useWhen`** on a layout: one sentence injected into the layout guide so the AI picks by purpose.
- **`||` line break** marker in a title slot: the renderer turns it into a break; it is text, never HTML.
- **`accent` tone** next to `default` and `inverse`.

### Taken as prompt rules and brief fields

- Prompt rules (`packages/content/src/ai/prompts.ts`, version `content-2026-10-11c`): hook as recognition plus an open loop with named archetypes, the three-yes gate (a pain, a proof, a payoff doable today) with a request for the missing payoff instead of an invented one, the shareability test as an advisory note, the arc (slide 2 stands alone, payoff and strongest number penultimate, a breather every three or four dense slides, the last slide fixed), copy budgets, slide count by objective, caption rules per channel and the channel gate metric for the Planner.
- **Brief fields**: thesis, emotion, action, trigger, closing, risk, first comment, hook archetype and rationale, objective.
- **Open questions** are blockers to confirm with the client; while any is open the content is not ready to export. **Cannot say** entries (with a reason) feed Brand Guard for that content; **can say** entries carry a source.

### Taken as data

- **Fact bank** (`product_facts`): each fact has a status (`printed_on_pack`, `catalog_only`, `pending_client`, `do_not_use`) and a source. Only the first two may appear in public copy. Fact checks and the claim critic both read the bank; a product claim outside it is unsupported.
- **Strategy fields**: pillar territory and metric, per-format cost and metric, and on the plan the critical node (the one bottleneck of the month), client needs and the reason for the content count.
- **Brand additions**: speaker point of view, audience vocabulary, words to use only when explained, forbidden topics with a reason and a severity, an antagonist.
- **Lessons log** (`brand_lessons`): a correction becomes a proposed rule; only a person confirms it. Confirmed lessons now reach the prompt: `loadBrandContext` appends them to the variable part of the brand block (newest first, at most 30), so every content step that reads the brand follows them.
- **Delivery freeze and manifest**: a delivery record (published at, link, credits, gates passed, delivered version) that freezes the content after publication, and an export manifest with files, captions per channel, credits and plain-text publishing tips.

### Taken in this last slice

- **Visual reviewer** (Reviewer, task `review_visual`, job `content.review_visual`, through `packages/ai` and logged in `jobs_log`). The persona is a stranger scrolling Instagram who gives the cover about one second. It checks eleven points: content outside the safe box, the cover corner, contrast, one highlight style per title, overlaps, tap targets, continuation cues, the last-slide call to action, widows and unbalanced breaks, walls of text, and the cover at 150px with its crop. It returns only localized notes `{slide, problem, fix}` with one atomic fix each, no score and no praise; no notes means pass.
  - **Input.** The worker renders the draft through the carousel module's own PNG export and sends the slide images with the copy, the layouts and the issues the renderer measured. Without a browser, when the render fails, or when the model or provider refuses images, the same review runs on text alone and the result says which mode was used. The images carry the client's logo and photos, so the call declares `brand_assets` and `client_photos` next to the brand texts; under `external_restricted` it goes only where those kinds may go.
  - **Advisory.** Notes never block an export and are never applied. They live in the job result (no new table); the editor shows them next to the claim check, each with a Dismiss. Dismissals are a per-person convenience stored in the browser per review, not shared. A note on a slide that does not exist is dropped. A person starts it (`edit_draft`, people only), like the claim check.
- **Planner proposals**: the strategy proposal may carry a territory per pillar, and the plan proposal a critical node and client needs. They are stored on the proposed rows; when a person uses the plan, notes already written on the plan in use win, otherwise the proposed ones apply.
- **No migration** in this slice. The factory work used 0035 (`product_facts`, `brand_lessons`, strategy columns, delivery record); the next free number is 0036.

### Taken as a listening grid (migration 0036)

- **Listening** (`listening_signals`, client page `/clients/<slug>/listening`, "Ascolto" in Italian): the agency logs verbatim signals from the audience by hand, a comment, message, question or mention, with platform, optional link, date and a theme tag. A status marks it `new`, `recurring` (a question that keeps coming back, the content candidate), `used` or `dismissed`. It stays empty until real data exists.
- **No scraping and no AI.** Nothing reads a platform; the service lives in `packages/social` (`listening.ts`). Reads need `view` on the client, writes `project.edit`, so people see only their clients and agents cannot write.
- **"Turn into content idea"** opens the existing new-carousel form with `?signal=<id>`: the signal text fills the brief and the first 200 characters (cut at a word) the brief `trigger`. Nothing is created until the person saves the form; `linked_content_id` is reserved for linking a content back and is not written yet.
- **Client transfer**: area `content`; a package cannot assert `used`, so it arrives as `recurring`.

### Left out, on purpose

- **Raw HTML** in build scripts: the AI picks layouts and fills slots; the renderer inserts text.
- **Autonomous mode** without approval, and auto-publishing.
- **GSAP and CDNs**, Pexels, other services with keys: no new paid or keyed dependency.
- **Video, reels, TTS**: static only.
- **Auto-mutating autoresearch loop** that rewrites copy or rules: Forgecy proposes, a person decides.
- **One brand's taste as a global rule**: no numbering, the yellow-on-paper ban, an anti-scam vocabulary, one client's content. Where a rule is a house voice (the em dash) it is a per-brand severity.
- **Metric claims**: statements such as "repost within 3 hours" or "recycle after 60 days" are shown only as plain-text tips in the manifest, never as numbers the tool scores or enforces.
- **A numeric score** from the model, anywhere.
- **Text-fill warning** (less than 80% of the usable width on multi-line blocks): the measurements give the ink box per line but not a per-layout usable width, so it would need new template data. Not built.
- **Tone alternation warning**: a slide's tone defaults to `default`, so "four in a row" does not mean the same thing as a declared alternation. Not built until layouts declare a tone cadence.

## Consequences

- The deterministic checks are free and fast and run in the browser too; the AI passes (claims, visual) cost a model call and stay advisory.
- A visual review sends slide images to the provider. That is covered by the client's AI policy like any file, and it is the reason the call names the asset kinds it sends.
- The prompt version changes, so a log line shows which rules a generation followed.
