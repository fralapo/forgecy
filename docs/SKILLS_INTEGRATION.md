# Forgecy V13 — awesome-agent-skills integration audit

Source: https://github.com/fralapo/awesome-agent-skills (reviewed October 12, 2026). The source repository is MIT-licensed, copyright 2026 Jacopo Latrofa. The new Forgecy playbooks paraphrase operational principles; no book digests or third-party raw corpora are copied.

## Inventory of all 13 skills

| Skill | Priority / decision | Forgecy application |
| --- | --- | --- |
| creative-director | P0 implemented | Audience tension, strategic concept vs execution, copy, Art Director and independent critique |
| marketing-mba | P0 implemented | Segmentation by real needs, positioning, verified offer, value proposition, campaign strategy |
| ux-ui-expert | P0 partial | Progressive disclosure, visible quality blockers, source status and user feedback; real user testing still needed |
| social-algorithm | P0 implemented | Recurring formats, qualitative community insights, real metrics and measurable but non-guaranteed hypotheses |
| image-gen-prompts | P1 implemented | Truth-preserving image composition and visual prompt principles |
| llm-wiki | P1 partial | Store original binary separately, source attribution and stale dossiers; no full entity graph yet |
| geo-ai-visibility | P1 deferred | Future optional factual GEO audit (needs web-crawl evidence and measurement) |
| public-speaking-persuasion | P2 partial | Ethical storytelling, clarity, persuasion without fake claims; not a full speech-coaching feature |
| jev | P2 deferred | Cheap intent routing only after benchmark vs existing model and error handling |
| awesome-readme | Dev only | Documentation improvement, not a customer-facing app |
| ffmpeg | Excluded | Video/reel workflow out of scope |
| seedance-prompts | Excluded | Video generation out of scope |
| video-editor | Excluded | Video editor out of scope |

## Router — one visible Leader, concise specialist instructions

The Leader remains the only user-facing coordinator. Internally, the workflow applies small playbooks per task instead of loading all 13 at once:

- Research: original source and reliable client claims; no invented citations.
- Analyst: audience needs, commercial context, social signals and real historical metrics.
- Strategist: a testable positioning hypothesis tied to verified products/services.
- Creative: distinct campaign concept, clear hooks, full payoff, readable Instagram and LinkedIn static adaptations.
- Brand Guard: adversarial review of strategic fit, originality, relevance, evidence, accessibility and feasibility.
- Imagery: controlled camera/style/light/brand palette, negative space for typeset copy, preservation of actual product identity.

Code: lib/skills/playbooks.ts, lib/skills/quality.ts and lib/agent-team.ts.

## Quality assurance workflow

Each model-generated proposal is validated with programmatic channel/format/page/count/source checks before a critical review. If there are structural blockers, Creative may revise ONCE. Brand Guard then returns reasoned scores, warnings and blocking issues; numbers are subjective editorial assessments, **not** predictive performance metrics.

The Leader displays warnings and blocking issues. The local database rejects proposals with unresolved blocking issues. User can request a new corrected proposal rather than bypass the gate. The existing audit trail preserves all agent hand-offs.

## Documents and client memory

Client uploads retain immutable originals in the private local data folder. Text-based PDFs are read in bounded 40-page ranges up to 500 pages and 80,000 characters; mixed PDFs preserve native text and send only scanned pages to OpenRouter in bounded 10-page/10 MB segments up to 200 pages. Each OCR segment is a separate budgeted API request. PDFs may be up to 64 MiB; other files remain capped at 10 MB. Extracted evidence is capped at 80,000 characters; invalid files or scanned PDFs do not turn into fabricated evidence. A source shows page coverage and truncation, preserves successful partial OCR, and offers retry.

The current pipeline reads native text from PDF/DOCX/CSV locally, uses OpenRouter API exclusively for OCR of scanned PDFs and images, parses supported CSV/Markdown product tables with exact row evidence, and performs local hybrid retrieval. No local OCR engine is used. Remaining work includes representative OCR/evidence evaluations, stronger extraction for irregular catalogs, and a versioned concept/entity wiki if real workflows demonstrate the need. Client documents should be scanned for malicious content and processed within restricted memory/CPU and outbound network limits before using this pipeline for arbitrary high-volume customer uploads.

## Validation

GitHub CI installs dependencies, typechecks, runs unit tests and repository invariant tests, and builds the Next.js production app.

This does not test live OpenRouter image generation or the full client workflow; these require credentials configured on the local installation. No videos/reels are enabled.

## Next prioritized work

- Durable queue with retries, cancellation, per-client AI budgets.
- Corpus-quality evaluation for OCR, tables, product/image matching, and retrieval on representative client documents.
- Consider a versioned concept/entity wiki only if observed multi-hop questions justify its added complexity.
- GEO audit with real page crawling and source-grounded findings; never synthetic rankings.
- Rich design layers/templates with export parity.
- Authenticated organizations and human reviewer roles.
- Instagram statistics are user-supplied JSON snapshots. Forgecy does not sign in to Instagram or collect data from its site.
- Document extraction stress tests, ZIP-bomb protection and serverless monitoring.
