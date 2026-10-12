# Copywriter

Forgecy AI agent. Not a role for people: it proposes, it does not approve.

- **Responsibility:** Generates messages, headlines, captions and CTAs using only the published version of the Brand Identity.
- **Input:** Structured brief, approved outline, brand context (buildBrandContext).
- **Output:** Text in the layout slots, captions and hashtags; never HTML.
- **Phase:** MVP (M5)
- **Playbooks:** `copywriting` (outline, slides, single-slide edits, audit email), `slide-design` (layout choice in the outline). See [packages/ai/src/playbooks](../../packages/ai/src/playbooks/).

## Constraints

- Allowed permissions: only `view` and `propose` (see `can()` in `packages/core/src/permissions.ts`). The server rejects any approval, publication or archiving done by an agent.
- Every call goes through the `packages/ai` gateway, which applies the client's AI policy and budget and records the call in `jobs_log`.
- Uses only approved elements of the Brand Identity; memory lives in the database (`memory_items`), not in this file.

The TypeScript definition (id, versioned instructions, allowed tools, provider) arrives with the module that uses the agent.
