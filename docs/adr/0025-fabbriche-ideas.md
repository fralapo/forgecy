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

- **Eight layouts** in `editorial-ig-4x5`, `editorial-linkedin` (version 1.4.0) and `editorial-fb-4x5` (version 1.1.0, same 1080x1350 canvas and safe zone as Instagram, so the layouts and CSS are identical; en and it samples, validated): `breather`, `evidence` (chat or mail card with a detail circle), `takeaway` ("Tradotto:" box), `steps` (numbered), `cover-photo` (with scrim), `cover-statement` (typographic), `cta-single` and `cta-conclusion` (no action).
- **The same ten layouts on the other three carousel templates** (`code` and `mockup` from before the factory set, plus the eight above), each recomposed for its canvas: `editorial-ig-1x1` (1080x1080, safe zone 64/64/96/64: smaller type, a 292x600 phone, code at 24 px), `editorial-stories-9x16` (1080x1920, safe zone 250/64/340/64: large type, a 420x860 phone, "Tap" instead of "Swipe") and `editorial-tiktok-photo` (1080x1920, safe zone 160/140/480/64: the same with a narrower column and a 400x820 phone). All three go to version 1.1.0 with the new layouts, their `it` interface labels, the `takeaway` label in `locales/en` and `it`, and a 1080x1920 sample cover for the two vertical ones. Nothing was skipped: `code` fits the square with a 24 px monospace and the unchanged 8-line snippet budget, which the long-text check accepts. To keep the render check clean, the title limit of the vertical templates went down to 44 characters on `list`, `steps`, `code` and `mockup` (the existing `list` titles overflowed at 56), `cta-single` on TikTok to 44, and `code` on TikTok to 320 characters.
- **Layouts per template:** `editorial-ig-4x5` 18, `editorial-fb-4x5` 18, `editorial-linkedin` 18, `editorial-ig-1x1` 18, `editorial-stories-9x16` 18, `editorial-tiktok-photo` 18.
- **Templates without the new layouts, on purpose:** `editorial-ig-1x1` (1080x1080), `editorial-stories-9x16` and `editorial-tiktok-photo` (1080x1920) keep their 8 layouts (version 1.0.1). Their canvas differs, so porting is more than a copy: each layout needs its own CSS pass (1:1 has 270px less height; 9:16 has 570px more and its own safe zones for the platform UI) and new samples checked for overflow. Not done in this slice.
- **`useWhen`** on a layout: one sentence injected into the layout guide so the AI picks by purpose.
- **`||` line break** marker in a title slot: the renderer turns it into a break; it is text, never HTML.
- **`accent` tone** next to `default` and `inverse`.

### Taken as prompt rules and brief fields

- Prompt rules (`packages/content/src/ai/prompts.ts`, version `content-2026-10-11d`): hook as recognition plus an open loop with named archetypes, the three-yes gate (a pain, a proof, a payoff doable today) with a request for the missing payoff instead of an invented one, the shareability test as an advisory note, the arc (slide 2 stands alone, payoff and strongest number penultimate, a breather every three or four dense slides, the last slide fixed), copy budgets, slide count by objective, caption rules per channel and the channel gate metric for the Planner.
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

### Taken as a per-channel adaptation (no migration)

- **Adapt to another channel** (Copywriter, task `adapt_channel`, job `content.adapt_channel`, through `packages/ai` and logged in `jobs_log`; prompt version `content-2026-10-11d`). From an Instagram carousel that is in review, approved or exported, a person asks for a LinkedIn document or a Facebook post. The model rewrites the angle for that audience (the payoff turns into a company procedure on LinkedIn) on the layouts of a published template of the target channel, and writes the caption by the channel's rules: LinkedIn has the hook in the first 210 characters and 3 to 5 sector hashtags; Facebook is one 4:5 frame, a long caption, 0 to 3 hashtags, no @mentions, a link allowed.
- **Skipping is an answer.** When the channel has no credible equivalent angle the model returns `creditableAngle: false`, a reason and no slides, and the panel proposes to skip that channel. A "credible" answer with no usable slide is turned into a skip too.
- **A proposal, never a change.** The proposal lives in the job result (no table): channel, angle, reason, slides (layout and plain-text slots, cut to the layout), caption, hashtags, template and the revision of the source it was made on. The gate metric (Instagram saves and shares, Facebook shares in groups and comments, LinkedIn dwell time and comments) is set by the pipeline, not by the model, and shown with the proposal. Slots are text; the renderer inserts them as text.
- **Accept creates a NEW draft.** `acceptAdaptation` (`edit_draft`, people only) creates a content for the channel with the client, pillar, rubric, product, audience and language of the source and the client's published Brand Identity at that moment, the brief of the source with the new angle as its text, and the proposed slides cut again to the layouts. It starts as `draft` and goes through the checks, the review and the approval like any other; the source is not touched. **Dismiss** answers the proposal and creates nothing. The single answer is claimed with a conditional update, so two clicks create one draft.
- **UI.** The panel "Other channels" sits next to the claim check and the visual review in the editor; it is enabled only for an Instagram carousel in review or approved and warns when the source changed after the proposal.
- **Facebook** needs a published template for its format; without one the job says so.

### Built as advisory checks

- **Text-fill** (render issue `narrow_text`, warning, carousels only): during the page measurement the widest rendered line is divided by the content width of the slot (`SlotMeasure.fill`). A text slot with 3 or more lines whose widest line is under 70% of that width is flagged ("uses X% of its width, the layout slot may be too wide for this copy"). The decision is the pure `narrowTextPercent` in `typography/lines.ts` (`NARROW_MIN_LINES = 3`, `NARROW_FILL = 0.7`). Slots with highlight or `||` break markers and list slots are not measured. Reports are not checked.
- **Tone alternation** (`rhythm:tone:<slideId>`, warning): 5 or more consecutive slides with the same tone, only when the deck uses at least two different tones. A deck that is all `default` is silent.

### Built, optional: Pexels stock photos

- **Optional and free.** `PEXELS_API_KEY` (a free key from pexels.com/api) is an optional string in the env schema; empty or absent turns the feature off and the interface shows a disabled panel with a hint. No SDK, no paid dependency: plain `fetch`.
- **Server-side only.** `searchPexels` and `getPexelsPhoto` in `packages/files` send the key in the `Authorization` header, with a 10 s timeout, one retry on 5xx, the `X-Ratelimit-*` headers read and a clear "rate limited" error at 429 (the API allows 200 requests per hour). The key never reaches the client, a log, a URL or an error message.
- **Import.** `importPexelsPhoto` (`packages/content`, `assets.upload` on the client, people only) asks Pexels for the photo by id (the browser sends no URL), downloads the `large2x` size only from `https://images.pexels.com`, caps it at the image limit, checks the type by magic bytes like an upload and stores it under the client. The asset has source `stock` (migration 0037, also adds `assets.stock` with photographer, photographer URL and licence), tags `stock` and `pexels`.
- **Rights stay pending.** The Pexels licence allows free commercial use, but the rights model has no "confirmed by licence" state and an import never approves rights: a person confirms them with the basis "licensed", like an upload.
- **Credit.** Using the photo in a slide adds "Photo: <Name> / Pexels" to the content's `stockCredits` (`addStockCredit`), which feeds the caption credit check and `manifest.txt`. Results in the interface link to Pexels and to the photographer, as the API terms ask.

### Built: text over a face

- **A declared face, not a guess.** An image slot value may carry an optional `face` box (`cx`, `cy`, `w`, `h`, fractions of the photo). Old data validates unchanged. In the editor, under the photo, "Mark a face in the photo" opens four percent fields; "No face in this photo" removes it. A photo with no box is never checked: there is no detection and no guess.
- **Measurement.** The renderer writes the box and the focal point as `data-face` and `data-focal` on the image (text only). The page measurement reads them into `SlotMeasure.face`; the mapping onto the slide is done outside the page by the pure `faceRectOnSlide` (`typography/face.ts`), which accounts for `object-fit: cover` (the larger scale wins, the focal point decides how the overflow is cropped, as in the renderer).
- **Decision.** `faceCoveredPercent` takes the intersection of a text slot (its ink box, else its rect) with the face and divides it by the face area; above 12% (`FACE_MAX_COVERED`) the render issue `text_over_face` is raised: severity `error` on the cover (slide 0) and `warning` on the others, so `RenderIssue` gained an optional `severity`. It runs for carousels only (the check is tied to the deliverable `language`, which reports do not pass). Messages are in `templates.renderIssues.textOverFace`, en and it.
- **Not done.** Click-to-place on the preview (the percent fields are the minimum), and a Brand Guard finding for it: the issue lives in the render issues of the export, as the other typography checks do.

### Built: contact sheet and one fix per round (visual review)

- **Contact sheet.** The review job stores nothing new: the PNGs of the render are the content-addressed exports the carousel module already writes, so the result now carries `frames` (their storage keys, in slide order; empty without a render). The editor page signs them (600 s, only keys under the client's own prefix, behind the same page permission as the editor) and the panel shows them in a 4-column grid with the slide number and the template's safe box drawn as a dashed outline from the effective safe zone (layout, else template, else format), in percent. Clicking a note scrolls to its slide and highlights it.
- **One atomic fix per round.** Notes are ordered by slide (`orderVisualNotes`) and the first one is badged "Next fix". "Done, review again" reruns the same job. The job records `round` in its result: `nextVisualRound` gives 1 for the first review, after a pass (no notes) or with `restart`, otherwise the previous round plus one, and `null` after round 3 (`MAX_VISUAL_ROUNDS`). At the cap with notes left the panel says to stop here and decide and offers "Start a new review series"; the server action and the job both refuse a fourth round without `restart` (`content.jobErrors.visualRoundsDone`). Dismissals are unchanged.
- **Never a score.** The result is `{ notes, draftRev, mode, round, frames }`, covered by the scripted-AI integration test.
- **Retention.** The frames are ordinary exports and are kept like them; there is no separate short-lived store or sweep.

### Built: severity of the AI-tells lint per brand (no migration)

- The brand writing rules (`verbal.writingRules`, optional, nothing changes when unset) take `aiTellsSeverity` and `dashSeverity`, each `off`, `warning` or `error`. They are edited in the writing-rules form of the Brand Identity editor and travel with the rules, which are diffed and proposed as a whole.
- `aiTellsSeverity` applies to every tell (fillers, contrasts, press-release words, gerunds, closers) and to the dash too; `dashSeverity` overrides it for the dash alone, because the dash is a house voice. Unset means `warning`, as before. `off` raises no finding; `error` blocks the export like any other error. The content checks read both from the published Brand Identity.

### Built: video ideas become static (migration 0038)

- Clients send video, reel and story-video ideas. The Planner prompt (`VIDEO_TO_STATIC_RULE`, prompt version `content-2026-10-11f`) says there is no video at any stage: such an idea is converted into a static carousel or a single-frame idea that keeps its goal.
- Each proposed plan item carries `convertedFromVideo` (boolean) and `conversionNote` (one line, at most 200 characters). Both are optional in the model output and in stored data (defaults `false` and empty), so old plans validate. They are stored on `content_plan_items` and shown on the plan page next to the proposal ("Was a video idea, now static" and the note); a person still accepts, edits or rejects the item.

### Built: the client's edited version (migration 0038)

- On a published (frozen) carousel, the export page has a "Client's version" panel. A person with `assets.upload` and `publish` on the client attaches up to 20 slide images (PNG, JPEG or WebP, 15 MB each) and/or a PDF (30 MB, magic bytes checked), through a same-origin route that reuses the library storage. Slides become library assets (source `upload`, tag `client-edit`, `content_id` set; an identical file already in the library is tagged and reused). The PDF is stored content-addressed under `clients/<id>/client-versions/` and linked by signed URL.
- `contents.client_version` (jsonb) records the files, who and when, and the notes; when it is set, the delivered version is the client's. It is the only thing that changes: the delivery record, the copy and the status stay as they were, so the content stays frozen. No AI call is involved.
- The panel keeps one note per change ("removed slide 6 because it sounded like an ad", "cover text changed to ..."), per slide or for the whole carousel. A person can turn a saved note into a brand lesson with "Propose as lesson": it is inserted in `brand_lessons` as `proposed`, `proposedBy` that person, once per note, and never confirmed here; confirming stays with `brand_identity.approve` in the lessons log, people only.
- Client transfer: `client_version` is cleared on import with the rest of the delivery record and listed among the reviewed JSON columns. The new plan-item columns are plain data.

### Left out, on purpose

- **Raw HTML** in build scripts: the AI picks layouts and fills slots; the renderer inserts text.
- **Autonomous mode** without approval, and auto-publishing.
- **GSAP and CDNs**, other services with keys: no new paid or keyed dependency. Pexels was first listed here because of its key; it is now built as an optional, server-side feature (see "Built as advisory checks" below).
- **Video, reels, TTS**: static only. A video idea from a client is converted into a static one (see above), never planned as video.
- **Auto-mutating autoresearch loop** that rewrites copy or rules: Forgecy proposes, a person decides.
- **One brand's taste as a global rule**: no numbering, the yellow-on-paper ban, an anti-scam vocabulary, one client's content. Where a rule is a house voice (the em dash) it is a per-brand severity.
- **Metric claims**: statements such as "repost within 3 hours" or "recycle after 60 days" are shown only as plain-text tips in the manifest, never as numbers the tool scores or enforces.
- **A numeric score** from the model, anywhere.
- **Text-fill at 80%**: ragged-right text legitimately ends short, so the built check uses 70% (see below).
- **Tone alternation on all-default decks**: a slide's tone defaults to `default`, so a run there means nothing; the built check stays silent unless the deck uses two or more tones.

## Consequences

- The deterministic checks are free and fast and run in the browser too; the AI passes (claims, visual) cost a model call and stay advisory.
- A visual review sends slide images to the provider. That is covered by the client's AI policy like any file, and it is the reason the call names the asset kinds it sends.
- The prompt version changes, so a log line shows which rules a generation followed.
