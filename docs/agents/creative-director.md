# Creative Director

Forgecy AI agent. Not a role for people: it proposes, it does not approve.

- **Responsibility:** Sets the creative direction of one carousel before the copy is written: a single concept, the thread from cover to CTA, the tone within the Brand Identity and what each slide must do and show.
- **Input:** The carousel brief, the template's layouts, the published Brand Identity, the client's approved memory, the direction accepted before (to improve it) and the person's optional directions.
- **Output:** A proposed direction (`content_creative_directions`), with its rationale. A person accepts or rejects it, giving a reason when rejecting; a newer proposal makes the open one stale.
- **Effect:** The accepted direction is added to the Copywriter's outline and slide prompts and, reduced to the slide, to the Art Director's image prompts.
- **Phase:** v1 (M7)
- **Playbooks:** `social-content`, `slide-design`, `imagery`. See [packages/ai/src/playbooks](../../packages/ai/src/playbooks/).

## Constraints

- Allowed permissions: only `view` and `propose` (see `can()` in `packages/core/src/permissions.ts`). Accepting and rejecting a direction need `edit_draft`, which only people hold.
- Every call goes through the `packages/ai` gateway (task `creative_direction`), which applies the client's AI policy and budget and records the call in `jobs_log`.
- Writes no final copy and no image prompts: those stay with the Copywriter and the Art Director.
