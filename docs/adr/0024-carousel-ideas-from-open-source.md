# 0024 · Carousel ideas taken from open-source projects

- Status: accepted
- Date: 2026-10-10
- Refines: the content and carousel pipeline (static only, the AI never writes HTML, people approve)

## Context

Six open-source carousel tools were read one by one: Open Carrusel, Carousel Generator (FranciscoMoretti), open-larryloop, ai-carousel-maker, the Slidev LinkedIn Carousel theme and a React/Satori LinkedIn generator. Forgecy already has the stronger core: slot-based templates, sanitising, per-format safe zones, Brand Guard, human approval, a multi-page PDF and AI only through `packages/ai`. open-larryloop contains no code, only a README.

## Decision

Taken now, small and inside the existing rules:

- **Unsourced figures** (ai-carousel-maker): a warning check `numbers:unsourced:*` when a figure in the slides or caption is not in the brief or the product sheet. It is a warning, so a reviewer marks it as seen; it never blocks. It runs only when the caller passes `sourceText`.
- **Hook alternatives and Markdown outline** (Open Carrusel, Slidev theme): the outline step also proposes up to two alternative hooks, which a person swaps in with one click; the outline can be copied as Markdown and pasted back (`outline-markdown.ts`), validated by the same schema and saved through the same action.
- **Copy budget** (Carousel Generator): the slide prompt asks for at most 70% of a slot's limit.
- **Hook kinds and narrative arc** (Open Carrusel, open-larryloop): the outline prompt names three kinds of hook and a default arc when no rubric applies.
- **Profile-grid crop guides** (Open Carrusel): an editor-only toggle on the slide preview draws the centered 3:4 or 1:1 crop Instagram shows on the profile grid (`profileGridCrop` in `packages/carousel/src/formats.ts`). It is CSS over the preview iframe; the preview route and every export never include it. It appears only for Instagram templates.
- **Slide undo/redo** (Open Carrusel): the editor keeps up to 30 snapshots of the draft document (`_lib/editor-history.ts`, pure reducer) with Undo and Redo buttons and Ctrl/Cmd+Z, Shift+Z outside text fields. Edits made within 800 ms share one step. An undo is an ordinary edit that the autosave sends against the current `draftRev`; the history is cleared whenever the draft is reloaded from the server (AI edit, revert, conflict reload).
- **Code and phone mockup layouts** (Slidev theme): two layouts of role `text` in `editorial-ig-4x5` and `editorial-linkedin` (both version 1.3.0). `code` has a plain-text slot of at most 8 lines and 360 characters, shown in a monospace block as escaped text with line breaks kept; `mockup` puts an image slot inside a phone frame drawn in CSS. No new role: the plain `text` layout stays the default for the role, and the AI picks these two by id like any layout.
- **Claim critic pass** (ai-carousel-maker): the job `content.critique_claims` (Reviewer, task `critique_claims`, through `packages/ai`) reads the current draft with the brief and the product sheet and returns, per slide or caption, claims at risk: a figure, a superlative, a health or legal promise, a time-bound promise, each with the exact words, a short reason and a risk level. The findings are the job's result (no new table); the checks show them as warnings `claim:<slideId>:<n>` while the quoted words are still in the copy, so fixing the copy clears them. They are advisory: a reviewer marks them as seen, they never block, and the critic never edits the copy. A quote that is not in the copy is dropped. It does not verify anything on the web: it judges only against the brief and the product sheet, so a warning means "nothing given supports this", not "this is false". The editor has a "Check claims" button (`claim-check.tsx`, `claim-actions.ts`).
- **Caption tiers** (Open Carrusel): the brief option `captionLength` (`short`, `standard`, `long`; briefs without it read as `standard`) maps to about 300, 900 and 2000 characters, never above the channel's limit. The slides prompt states the budget, and the check `caption:tier` warns when the caption is more than 20% over it.

Left out, on purpose:

- Any renderer other than Chromium (Satori, Puppeteer, Slidev), model-written HTML, calls to an AI provider outside `packages/ai`, auto-publishing, video, and loops that rewrite copy without approval.
- A swipe cue on `editorial-linkedin`: the template omits it because the LinkedIn document viewer has its own arrows.

## Candidates not built yet

Claim critic pass (ai-carousel-maker); caption tiers (Open Carrusel); title highlight slot (React/Satori generator); a manual performance feedback loop (open-larryloop). Each needs its own schema or UI work and its own decision.
