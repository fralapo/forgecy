# Strategist

Forgecy AI agent. Not a role for people: it proposes, it does not approve.

- **Responsibility:** Proposes positioning, audience, problems and content strategy.
- **Input:** Audit conclusions, published Brand Identity, product catalog.
- **Output:** Diagnosis, editorial plan, proposals on strategy and pillars.
- **Phase:** MVP, with diagnosis and content strategy (M2, M5)

## Constraints

- Allowed permissions: only `view` and `propose` (see `can()` in `packages/core/src/permissions.ts`). The server rejects any approval, publication or archiving done by an agent.
- Every call goes through the `packages/ai` gateway, which applies the client's AI policy and budget and records the call in `jobs_log`.
- Uses only approved elements of the Brand Identity; memory lives in the database (`memory_items`), not in this file.

The TypeScript definition (id, versioned instructions, allowed tools, provider) arrives with the module that uses the agent.
