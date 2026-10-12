# Forgecy editorial intelligence — source-to-product mapping

Scope: **static Instagram posts/carousels and LinkedIn text/document posts only**. No reels, CapCut editing, video scripting or video production.

This playbook is a paraphrased operational interpretation of eight PDF training resources supplied by the product owner, primarily from Marketing Espresso Academe. The original PDFs are **not** committed to the repository; this file is a lightweight traceability summary, not a redistribution.

## Principles implemented

### 1. Start by listening (Community e Content Creation, pp. 3–20)
- The client **Library → Voce della community** accepts manually recorded, anonymized feedback: comments, FAQs, reviews, questions, objections and message summaries.
- Each observation records topic, channel, source URL (when public), audience need and context. All rows use client-scoped RLS. Observations can be deleted.
- Related topics are grouped. One item = isolated hypothesis; multiple without independent source URLs = candidate; multiple with distinct traceable URLs = corroborated candidate, **not a statistically representative truth**.
- Analyst uses these qualitative inputs, separating questions/needs from substantiated outcomes. Recurring formats are proposed only where pattern + brand strategy align.
- Never automatically import private DMs. Manually entered text should be de-identified; the interface displays a privacy reminder.

### 2. Emotional and rational copy (Come suscitare emozioni attraverso il copy, pp. 2–10, 12–13)
- Know who the reader is, what they want and the situation driving interest.
- Pair a respectful emotion (relief, confidence, belonging, reassurance) with an evidenced practical benefit.
- Avoid invented savings, scientifically unsupported claims, fake testimonials and artificial urgency.
- The structured editorial brief explains **audience need, emotional angle and rational proof** per static piece.

### 3. Hook, body, payoff (I falsi miti da sfatare per uno script efficace, pp. 7–15, 19–29)
- This source is originally about **video scripting**. Only the medium-independent ideas are adapted to static pieces.
- A strong first-slide hook is relevant and honest; the remaining slides must **deliver** what the hook promises.
- Keep the body clear, useful and coherent; avoid dense information.
- A conclusion communicates the takeaway; a CTA invites an action. Use **one CTA or none**, according to the objective.
- There is no universal hook formula; recognizable recurring formats need relevant audience demand.

### 4. Format and crop rules (Guida ai formati social, pp. 3, 16)
- Instagram static portrait default: **1080 × 1350, 4:5**, preview/grid may crop to **3:4**.
- LinkedIn static carousel-style document default: **1920 × 1080, 16:9**, exported as multipage PDF (not presented as organic Carousel Ads).
- PNG/PDF exports use the chosen client's name instead of Forgecy branding.
- Ensure text is legible at mobile size and stays in a sensible inset region. Platform specifications can change; revalidate periodically against official sources.

### 5. Fonts and visual modules (Migliori font di Canva, pp. 2–47; Raccolta app utili di Canva, pp. 3–13)
- Treat the PDF as **typography and visual-treatment inspiration**, not as font license, downloadable font package or evidence that an integration exists.
- Patterns, frames, controlled texture, typography treatments and palette extraction are ideas for later versions of the editor.
- Respect the client's established logo, palette and typography before suggesting alternatives. Do not auto-apply arbitrary Canva aesthetic choices.
- Rich-layer editing and external Canva app connections **are not implemented** by this change.

### 6. Analytics and explicit exclusions
- Guida alla lettura della tab analisi di LinkedIn (pp. 1–3) is essentially a link/video pointer plus a screenshot of the analysis tab. It **does not document** detailed measurement procedures or authorize invented LinkedIn statistics.
- Existing real-data-only results model remains. A direct LinkedIn analytics connector and trend attribution are separate tasks.
- 5 trucchetti su CapCut (pp. 1–7) relates to video editing and is intentionally excluded from product scope.

## Client workflow

1. Choose client.
2. Library: register sources/offers and optionally anonymized community signals.
3. Approve current-state dossier.
4. Ask Leader for a campaign goal, product/service and period.
5. Analyst assesses verified company data, past results and community feedback with explicit uncertainty.
6. Strategist prioritizes objectives and grounded audience needs.
7. Copywriter and Art Director produce Instagram/LinkedIn **static** posts plus an inspectable editorial brief.
8. Brand Guard checks hook vs payoff, product claims, brand coherence, image/copy fit and one-CTA discipline.
9. Human reviews and approves campaign and creative assets, edits if needed, then exports platform-fit formats.
10. Use measured results and new audience observations in future planning, never infer causal performance from reactions alone.

## Acceptance expectations

- No community evidence crosses customers.
- A lone opinion is never reported as a representative pattern.
- Referenced signal IDs must exist for the active client.
- Each AI-generated item includes a structured editable rationale, but this rationale **does not automatically certify quality**.
- Edited approved content reverts to draft; linked LinkedIn variants invalidate when the Instagram original changes.
- Instagram remains 4:5 (1080×1350). LinkedIn PDF pages are 16:9 (1920×1080).
- No video or reel UI, APIs or agent-generated deliverables.
- All provider-driven performance numbers remain sourced and clearly labelled.
