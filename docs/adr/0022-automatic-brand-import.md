# 0022 · Automatic brand import

- Status: accepted
- Date: 2026-10-09
- Refines: the "AI agents propose and do not approve" rule of `CLAUDE.md` (an import run acts on behalf of the person who started it)

## Context

The Brand Identity import (links and files, then the Brand Analyst, then proposals) ended in a manual queue: accept each proposal, submit for review, approve with a changelog and a self-approval note. Agencies asked for the opposite: paste the links and get an approved brand, taking the website's images too, and later social profiles. A real run on a staging site also showed that the extraction was weak (colors invented from product-variant words, no fonts, no logo, quotes never checked against the page), so removing the human click without fixing the extraction would publish wrong data.

## Decision

- **The person who adds the links is the approver of record.** An import run is started by a person (the "Add a brand" box, a website or profile added to a client, "Re-analyze", or a client created with a website). The job carries that person as `requestedBy`; accepting and publishing use them as `reviewed_by` and `approved_by`, so the database constraints and the activity log stay true. Nothing takes an actor from the caller and an agent cannot run it as itself: `applyImport` (`packages/brand/src/auto-import.ts`) reads the person from the job, loads their access (`userActor`) and needs, on that client, the same permissions the buttons need (`review`, `edit_draft`, `publish`, `brand_identity.approve`). A run nobody started, a deactivated person, a person without access to the client or without those permissions writes nothing: the proposals stay pending and the source says why.
- **Only public pages apply themselves.** Automatic apply covers `website` sources and the social-profile kinds (`instagram`, `facebook`, `linkedin`, `tiktok`). Documents (brand books, PDFs, screenshots, questionnaires, interviews) keep the review queue, as do manual proposals and proposals from other agents.
- **The gate is verification, not judgment.** An item reaches the draft only if it passes deterministic checks (`packages/brand/src/import/gate.ts`, `verify.ts`): its quote is in the normalized text of the cited page; a hex color is in the data the browser extracted from the site (CSS variables, `theme-color`, computed colors); the proposal still applies to the draft and passes `checksFor`; colors of framework-default palettes (Bootstrap and similar) and generic or system font stacks are discarded. What fails is discarded and counted on the source, not queued. The model may name and give a role to extracted colors, never introduce one.
- **A person's work is never overwritten.** A field a person wrote (an item with no sources, or a value they confirmed by hand that did not come from a proposal) is kept; the proposal is marked rejected with "hand-edited field kept" and counted. Logo variants have no provenance, so they count as written by a person and a re-import does not replace them. Only empty fields, list additions and values that an earlier import set can change.
- **What needs a person stays pending.** Sensitive fields in conflict or with low confidence, and fields that another source or person also proposes (a brand book, a colleague, another run), wait in the queue.
- **Shared drafts are not published.** If the open draft was created or edited by someone else, or is in review, the accepted items stay in the draft and nothing is published; the source says so.
- **Undo.** The brand page shows "Imported automatically on ..." with the number of items and of items kept for review, and "Undo import": the version the import published goes back to the one before it, restored as a new draft and published by the person who clicks (`undoImport`). It works only on the current version, only when an automatic import published it, and replaces an open draft only after the person confirms.
- **Social profiles: logged-out public pages only.** A profile URL is fetched only when its host is on the platform allow-list (one host set per platform, not whatever the link says), `robots.txt` allows it, with a single request and no login, scripts or follow-up crawling. A link found on an attacker's site that points off-platform is never fetched. LinkedIn `/in/` links found on a site are never followed; a person's LinkedIn profile added by hand imports its text but never its picture. Pages behind a login wall or blocked by `robots.txt` import nothing and the source says so.
- **Images.** Pictures found on the website (and one profile picture per social profile) are downloaded pinned to a public address, capped, sniffed from their bytes and measured after decoding, then stored in the asset library with source `site` and tags `[class, "site"]` (class: product, scene, graphic, logo) or `["social"]`. The logo is also registered as a brand source for the logo variant. Rights stay a person's: images found by a run started by a person are attested on their behalf as the site's own content; profile pictures stay drafts until someone confirms the rights in the content library, which now accepts `site` images like uploads. The brand page lists them read-only (`listBrandImages`).
- **Prospects with a website publish on creation.** A client created with a website address (the Clients form or "Add a brand") queues the first scan as its creator, so the import applies itself and publishes the first version without a click. Both entry points share one creation function (`createClientFor`).
- **Completeness.** The brand page shows how many of nine sections (about, tagline, audience, tone, aesthetics, fonts, palette, logo, images) are filled (`brandCompleteness`).

## Consequences

- A website or profile added by a person with the right permissions changes the published Brand Identity at once. The protection is the gate, the rule that people's edits win, the activity log (`brand.proposal.auto_accept`, `brand.version.publish` with `auto: true`, the run id) and one-click undo.
- The review queue is no longer a required step. It stays for documents and for what is uncertain, and the manual submit and approve flow is unchanged.
- The `CLAUDE.md` line becomes: "AI agents propose and do not approve: `can()` in `packages/core` enforces this server-side. An import run acts on behalf of the person who started it (ADR 0022)."
- Upgrading needs migration `0033_brand_visual` (asset source `site`, `brand_sources.visual`) and changes behavior: website and social imports publish automatically. The next free migration number is 0034.
- Every automatic import costs one AI call for the interpretation (positioning, audience, voice); everything else is deterministic.

## Not covered

- Palettes that exist only after JavaScript runs, in images or in `oklch()` colors; Elementor kit variables kept on body classes.
- Social profiles blocked by `robots.txt` or behind a login wall; profile pages whose markup the extractor does not recognize.
- Vision-model palette extraction, dark-mode variants, border radius and spacing tokens, products detection and feeding the image library to image generation.
- A page that lies: the gate checks that a quote and a color are on the site, not that the site is right about itself.
