---
name: agent-playbooks
description: Edit or add a Forgecy agent playbook (the craft guidance appended to agent system prompts in packages/ai/src/playbooks). Use when changing how the Strategist, Brand Analyst, Copywriter or Art Director write, or when porting a skill from fralapo/awesome-agent-skills.
---

# Agent playbooks

Playbooks are short know-how blocks appended to Forgecy agents' system prompts with `withPlaybooks(system, ...ids)` from `@forgecy/ai/playbooks`. Read `docs/adr/0007-agent-playbooks.md` first.

## Rules

- One file per playbook in `packages/ai/src/playbooks/`, exporting one string that starts with `## <Title>`. Keep it under 3000 characters (a test enforces it): it rides along on every call, local models included.
- Write rules for the agent, in English, in plain sentences. Craft only: never client data, never numbers presented as facts, never anything that contradicts the agent's rules (facts only from the data, static content only, the Brand Identity prevails, agents propose and never approve).
- Register it in `index.ts` (`playbooks` and `playbookSources`), and list the source in `NOTICE.md` with its license. Only port material whose license allows it.
- When any playbook text changes, bump `PLAYBOOK_VERSION` and the prompt version of every agent using it (`PROMPT_VERSION` in `packages/audit/src/ai/agents.ts`, `CONTENT_PROMPT_VERSION` in `packages/content/src/ai/prompts.ts`).
- Update the agent's file in `docs/agents/` (the **Playbooks** line).
- Run `pnpm --filter @forgecy/ai test`, `pnpm typecheck` and `pnpm lint`.
