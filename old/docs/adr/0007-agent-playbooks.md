# 0007 · Agent playbooks from awesome-agent-skills

- Status: accepted
- Date: 2026-10-06
- Note 2026-10-08: this number was used twice; refer to this ADR by its file name (see 0016).

## Context

The agency asked to bring the most useful skills of [fralapo/awesome-agent-skills](https://github.com/fralapo/awesome-agent-skills) (MIT) into Forgecy. Those skills are Claude Code `SKILL.md` folders, some of them hundreds of kilobytes of references, loaded on demand by a coding agent. Forgecy's agents are not coding agents: they are system prompts called through the AI gateway with a structured output, with whatever provider the agency picked (including small local models).

## Decision

- The relevant skills become short **playbooks** in `packages/ai/src/playbooks/`: one TypeScript string each, a few hundred words, rewritten as rules for Forgecy's agents and compatible with their constraints (facts only from the data, static content only, the Brand Identity's rules prevail).
- `withPlaybooks(system, ...ids)` appends them after the agent's own rules, under a heading that says those rules prevail. The content and audit prompt versions are bumped so `jobs_log` shows which runs used them.
- Picked: `social-algorithm` → `social-content`; `marketing-mba` → `positioning`; `creative-director` and `public-speaking-persuasion` → `copywriting`; `image-gen-prompts` → `imagery`; `ux-ui-expert` and `geo-ai-visibility` → `website-review` and `slide-design`.
- Left out: `ffmpeg`, `seedance-prompts`, `video-editor` (no video in Forgecy), `awesome-readme`, `llm-wiki` (not agent work), `jev` (calls a model outside the gateway).
- Attribution and the MIT notice are in `packages/ai/src/playbooks/NOTICE.md`.

## Consequences

Every affected call carries roughly 300 to 800 more prompt tokens; the content agents' system prompt is cached with the Brand Identity block, so the cost on repeated calls is small. Playbooks hold craft, never data about clients. When a playbook changes, `PLAYBOOK_VERSION` and the prompt versions of the agents using it change too.
