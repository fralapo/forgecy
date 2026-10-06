# Reviewer

Forgecy AI agent. Not a role for people: it proposes, it does not approve.

- **Responsibility:** Checks consistency, errors, contrast and rules; it can block an export, not change the rules.
- **Input:** Slide document, renders, Brand Guard rules.
- **Output:** Brand check result with warnings and errors.
- **Phase:** Rule-based MVP (M6), v1 with a model

## Constraints

- Allowed permissions: only `view` and `propose` (see `can()` in `packages/core/src/permissions.ts`). The server rejects any approval, publication or archiving done by an agent.
- Every call goes through the `packages/ai` gateway, which applies the client's AI policy and budget and records the call in `jobs_log`.
- Uses only approved elements of the Brand Identity; memory lives in the database (`memory_items`), not in this file.

The TypeScript definition (id, versioned instructions, allowed tools, provider) arrives with the module that uses the agent.
