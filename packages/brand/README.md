# @forgecy/brand

Brand Identity module (M4): versioned client identities, AI proposals, DTCG design
tokens, brand book import and the brand block of generation prompts.

## Stable API for other modules

Content, carousels, the brand check and exports read the **published** version
only, through these functions, and store `versionId` on what they generate:

```ts
import {
  getPublishedBrandIdentity,
  getBrandIdentityVersion,
  loadBrandContext,
} from "@forgecy/brand";

const identity = await getPublishedBrandIdentity(db, actor, clientId); // null → generation must stop
const pinned = await getBrandIdentityVersion(db, actor, { clientId, versionId }); // published or archived
const ctx = await loadBrandContext(db, actor, clientId, {
  channel: "instagram",
  formatKey,
  pillarKey,
  brief,
});
// ctx.stable (cacheable) + ctx.variable go in the prompt; ctx.versionId goes on the content version.
```

- `buildBrandContext(identity, options)` is the pure version (no database).
- `tokensToCssVars(identity.tokens)` gives the renderer `--brand-color-semantic-background` and so on.
  Prompts only ever see role names (`tokenRoleNames`), never values.
- Other modules that want to change the identity call `proposeChange(db, actor, { clientId, path, value, evidence })`.
  They never write versions.
- `@forgecy/brand/client` is the browser-safe subset (schemas, tokens, fields, JSON Patch).
- `@forgecy/brand/handlers` exports the worker handlers (`brand.import_source`).

## Governance (enforced on the server)

- People edit the draft, review proposals, approve and publish. Agents can only call `proposeChange` and `addSource`:
  every other service function refuses an agent actor before checking anything else.
- A version is immutable from `approved` onward. A database trigger (`brand_versions_guard`) rejects any change to
  content, number or approval data, and only allows `approved → published → archived`.
- One published version per client and one open draft, with partial unique indexes.
- Publishing requires a changelog of at least 20 characters and a "Seen" on every open check.
  A self-approval (approving a draft you edited or submitted) also requires a note.
- Sensitive fields (positioning, promise, tone, values, audience, palette...) are accepted one by one. When the
  confidence is low or the proposal is in conflict, accepting also requires a note.

## Proposals

A proposal is one field change as an RFC 6902 JSON Patch over `{ document, tokens }`, computed against the draft
when it is created, with `test` ops on every value it replaces. If the field changes afterwards, the patch no longer
applies and the proposal becomes `stale`. Accepting one proposal makes the other pending proposals on the same field
stale too. Confidence is computed from the kinds of the cited sources, never taken from the model:

- a direct client source is `high`;
- three or more observed sources are `high`;
- one or two observed sources are `medium`;
- AI inference alone, or conflicting proposals, is `low`.

## Import

`brand.import_source` reads PDF (unpdf), DOCX and PPTX (OOXML with fflate), SVG, fonts (name table), images and
text. It extracts page texts with their locator, theme colors and fonts. Then the Brand Analyst (AI gateway, task
`brand_propose`) turns the pages into proposals. With policy `no_ai` or no configured provider, only the
deterministic part runs (colors and fonts). A retry removes the pending proposals of the previous attempt.

## Deviations from the spec

- **Draft as a version row.** The spec keeps the draft in `brand_identities.draft`. Here the draft is the
  `brand_identity_versions` row in `draft` or `in_review`, with a `rev` column for optimistic concurrency. Approval
  freezes that same row, so the approved content is exactly what was reviewed.
- **`buildBrandContext` lives here**, not in `packages/core`, so the module stays inside its own folder. It is
  exported as part of the stable API.
- **No `assets` table yet.** Logos and font files point to `brand_sources` rows (`sourceId`). The asset library
  can take them over later.
- **Routes** are `/brand/:clientSlug/...` (folder `apps/web/app/(app)/brand`) instead of
  `/clients/:clientSlug/brand/...`, because the client pages belong to another module. Moving them is a rename.
- Not built yet: the Observations and Conflicts pages (conflicts are shown in Proposals), the rendered preview (it
  needs the M3 renderer), website reading (Audit module) and Brand Book export (v1).
