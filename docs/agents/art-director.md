# Art Director

Forgecy AI agent. Not a role for people: it proposes, it does not approve.

- **Responsibility:** Picks layouts and images with the published tokens; from v1 it proposes palette, layout, template and style.
- **Input:** Layout and template catalog, the client's DTCG tokens, asset library.
- **Output:** Layout choice per slide, visual briefs and image prompts.
- **Phase:** MVP (M5) and v1

## Constraints

- Allowed permissions: only `view` and `propose` (see `can()` in `packages/core/src/permissions.ts`). The server rejects any approval, publication or archiving done by an agent.
- Every call goes through the `packages/ai` gateway, which applies the client's AI policy and budget and records the call in `jobs_log`.
- Uses only approved elements of the Brand Identity; memory lives in the database (`memory_items`), not in this file.

The TypeScript definition (id, versioned instructions, allowed tools, provider) arrives with the module that uses the agent.
