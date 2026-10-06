# @forgecy/brand-guard

Brand Guard (M6): rule-based checks of a content against the client's published Brand
Identity, a coherence score with its evidence, and the review gates (spec Page 46
"Carousel brand check", Page 47 approval, C-6 and UXA-P4-12/13/14/52).

Brand Guard **signals, it does not block**: nothing it finds stops sending to review or
the export. The only finding that blocks approval is an AI image not approved by a
person. Agents (the Reviewer) can run checks; ignoring, reopening and "Ho visto" are
people's decisions, refused to agents on the server.

## API for the Contents module

```ts
import {
  runBrandCheck,
  getBrandCheck,
  ignoreFinding,
  reopenFinding,
  confirmBrandCheckForApproval,
  exportGate,
} from "@forgecy/brand-guard";

// On save, after generation and on «Riesegui controlli» (a job of the Contents module):
const { report } = await runBrandCheck(db, actor, {
  clientId,
  subject: { type: "carousel", id: carouselId, version: 3 },
  content, // GuardContent built from the carousel (see below)
  render, // optional: renderer measures + pixel contrast
  brandVersionId, // the BI version the carousel was generated with; default: published
});

// Page 46: latest report with ignores, "Ho visto", open counts and resolved findings.
const check = await getBrandCheck(db, actor, { clientId, subject });

// Inside the approve transaction (throws CHECKS-NOT-ACKNOWLEDGED, AI-IMAGES-NOT-APPROVED,
// BRAND-CHECK-STALE or BRAND-CHECK-NOT-RUN in details.code):
await confirmBrandCheckForApproval(tx, actor, { clientId, subject, acknowledgedKeys });

// Final export: allowed only by human approval; open findings are just reported.
exportGate(carousel.status === "approved", check?.report ?? null);
```

`GuardContent` is a neutral description of the carousel: canvas size, slides with layout,
role (`cover`, `content`, `cta`, `closing`) and slots (`text`, `list`, `image`) with their
limits from `template.json`, the brand token roles they use (`color.token`,
`background.token`), font family and size, image assets with origin and approval, plus
caption, hashtags, the linked approved product and whether the brief asks for the price.
Validate it with `guardContentSchema`.

### Render checks

`GuardRender.slides[].slots` has the same shape as the renderer's `SlotMeasure`
(`@forgecy/carousel/export`, `captureSlides(...).slots`). For contrast on pixels, pass
each capture to `sampleContrastFromPng(capture.png, capture.slots)` from
`@forgecy/brand-guard/pixels` (server only) and put the result in `contrast`. When a
pixel sample exists for a slot, it replaces the token-based contrast check.

## Checks (MVP, default severities)

| Code                                                          | Severity                                   | Origin |
| ------------------------------------------------------------- | ------------------------------------------ | ------ |
| `text_length`, `list_items`                                   | error over the slot limit                  | json   |
| `word_density`                                                | warning over 90% of words per slide        | json   |
| `hook_length`                                                 | warning (default 12 words)                 | json   |
| `cta_missing`                                                 | warning                                    | json   |
| `structure`                                                   | note (format steps, opening slide)         | json   |
| `forbidden_word`                                              | error                                      | json   |
| `spelling`                                                    | warning (`e-commerce` vs `ecommerce`)      | json   |
| `avoid_topic`                                                 | warning (literal mentions only)            | json   |
| `sentence_length`, `emoji`, `exclamation`, `hashtags`         | warning or note, from the writing rules    | json   |
| `sensitive_claim`                                             | warning unless it repeats a proven message | json   |
| `product_fact`, `price_not_requested`                         | error (numbers and units vs product data)  | json   |
| `off_brand_color`, `off_brand_font`                           | error, with the nearest role               | json   |
| `contrast`                                                    | error (4,5:1, large text 3:1, UXA-14)      | json   |
| `contrast_on_render`                                          | error, measured on pixels                  | render |
| `text_overflow`, `outside_slide`, `overlap`, `too_many_lines` | error                                      | render |
| `outside_safe_zone`                                           | error; warning for decorative elements     | render |
| `thumbnail_legibility`                                        | warning under 8 px in a 123 px thumbnail   | json   |
| `low_resolution`                                              | warning; error under 50%                   | both   |
| `image_missing`                                               | error                                      | render |
| `ai_image_unapproved`, `ai_image_rejected`                    | error, **blocks approval**                 | json   |
| `ai_next_to_photo`                                            | warning                                    | json   |

Checks that need the model (hook specificity, tone, topics to avoid as themes, product
facts without numbers) are listed in `report.notRun` and belong to the Reviewer agent.

Each finding has a stable `key` (check, slide, slot and what was found) and a
`blockHash`: an ignored warning reopens when its block changes. Errors cannot be
ignored. "Ho visto" is stored per content version.

## Coherence score

`report.coherence` is 100 minus 15 per error, 5 per warning and 1 per note, per category
(vocabulary, claims, editorial, visual, layout, images) and overall, with the bands of
spec 12.6 (critico, debole, discreto, buono, eccellente) and the finding keys as evidence.
Ignored findings do not count. It is never meant to be shown alone. Spec 12.6 says "no
numeric scores in the MVP" for the eight audit scores; this is the content coherence the
Brand Identity tab asks for ("nell'MVP c'è solo la coerenza, come brand check a regole"),
so the UI may show only the band and the findings if the Product Owner prefers.

## Data

- `brand_check_runs`: one row per run with the full report (jsonb), counts, score, the BI
  version used and who ran it.
- `brand_check_issue_states`: people's decisions (`ignored` with reason and optional note,
  280 characters max, required for "Altro"; `acknowledged` per version), never written by
  agents.

Events in `audit_events`: `brand_check_completed`, `brand_check_issue_ignored`,
`brand_check_issue_reopened`, `brand_check_acknowledged`.
