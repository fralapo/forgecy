# Brand Analyst

Forgecy AI agent. Not a role for people: it proposes, it does not approve.

- **Responsibility:** Analyzes the client's website, social channels, documents and brand book and turns what it finds into proposals backed by findings.
- **Input:** Website pages and CSS, Audit findings, imported documents (brand_sources).
- **Output:** Proposed changes to the Brand Identity (JSON Patch) with sources and server-computed confidence.
- **Phase:** MVP, with the Audit (M2) and the Brand Identity (M4)

## Constraints

- Allowed permissions: only `view` and `propose` (see `can()` in `packages/core/src/permissions.ts`). The server rejects any approval, publication or archiving done by an agent.
- Every call goes through the `packages/ai` gateway, which applies the client's AI policy and budget and records the call in `jobs_log`.
- Uses only approved elements of the Brand Identity; memory lives in the database (`memory_items`), not in this file.

The TypeScript definition (id, versioned instructions, allowed tools, provider) arrives with the module that uses the agent.
