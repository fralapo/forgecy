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

Left out, on purpose:

- Any renderer other than Chromium (Satori, Puppeteer, Slidev), model-written HTML, calls to an AI provider outside `packages/ai`, auto-publishing, video, and loops that rewrite copy without approval.
- A swipe cue on `editorial-linkedin`: the template omits it because the LinkedIn document viewer has its own arrows.

## Candidates not built yet

Claim critic pass (ai-carousel-maker); caption tiers, profile-grid crop overlay, slide undo stack (Open Carrusel); code and mockup layouts (Slidev theme); title highlight slot (React/Satori generator); a manual performance feedback loop (open-larryloop). Each needs its own schema or UI work and its own decision.
