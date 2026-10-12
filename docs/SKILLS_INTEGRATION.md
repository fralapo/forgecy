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

The Leader displays warnings and blocking issues. The Postgres approval RPC rejects proposals with unresolved blocking issues. User can request a new corrected proposal rather than bypass the gate. The existing audit trail preserves all agent hand-offs.

## Documents and client memory

Client uploads retain immutable originals in private Supabase Storage. Text-based PDFs (bounded to the first 40 pages), DOCX, plain text, Markdown and CSV are converted into limited evidence text. Up to 10 MB per file and 80,000 extracted characters; invalid files or scanned PDFs do not turn into fabricated evidence. A source shows ready, pending, or error and offers retry.

OCR, PDF images, advanced tabular extraction, background workers and full concept/entity wiki remain future work. Client documents should be scanned for malicious content and processed within restricted memory/CPU and outbound network limits before using this pipeline for arbitrary high-volume customer uploads.

## Validation

GitHub CI installs dependencies, typechecks, runs unit tests for playbook/quality and PDF extraction, applies SQL migrations 0001 through 0006 on PostgreSQL with RLS tests, and builds the Next.js production app.

This does not test live Supabase, OpenRouter, OpenAI image generation, Meta OAuth or full client workflow; those require managed credentials and an acceptance environment. No videos/reels are enabled.

## Next prioritized work

- Durable queue with retries, cancellation, per-client AI budgets.
- Client wiki with versioned evidence/conflict resolution and native PDF/OCR processing isolation.
- GEO audit with real page crawling and source-grounded findings; never synthetic rankings.
- Rich design layers/templates with export parity.
- Authenticated organizations and human reviewer roles.
- Meta integration token refresh, live authorization tests, attribution.
- Document extraction stress tests, ZIP-bomb protection and serverless monitoring.
