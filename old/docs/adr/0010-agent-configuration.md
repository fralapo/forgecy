# 0010 · How Admins configure the agents

- Status: accepted
- Date: 2026-10-06

## Context

Pages 54–55 of the UX specification ask, for v1, that Admins can switch an agent off, choose the model of each of its tasks and publish new versions of its prompt with a changelog, and that every run records the version it used. The built-in prompts live in the code next to each module (the playbooks and the module prompts) and carry the rules that keep agents safe: they propose, never approve, and follow the Brand Identity and the client's AI policy.

## Decision

- An agent's prompt is not replaced. Admins publish **agency instructions**, versioned in `agent_instructions` (`draft` and `published`, at most one draft per agent, changelog required). The gateway appends the newest published version after the module's own system prompt, under a heading that says the rules above win. `jobs_log.input_summary.agent` records the agent and the instructions version of every run.
- `agent_settings` holds, per agent, whether it is active and an optional service and model per task. The gateway reads both through the routing (`withAgents`, cached with the AI settings). A task model whose service has no key is ignored, so a half-made choice never stops work.
- A switched-off agent is refused in the gateway before any provider call, with a `blocked` row in `jobs_log` (`agent_disabled`). Images belong to the Art Director AI.
- Switching an agent off asks for its key (for example `copywriter`) typed, not its name: the key is the same in every interface language.
- The task each agent runs is a code table (`AGENT_TASKS`); a caller can name the agent when it runs another agent's task (the audit report email is the Copywriter's).
- Only a user with the Admin attribute changes the configuration (`agents.configure`); agents never do.
- "Try the prompt on an example", the statistics tab, the accepted-proposals rate and the agent memory page are not part of this step.

## Consequences

Agency instructions can steer tone and preferences without being able to remove the safety rules. A new AI task must be added to `AGENT_TASKS` (a test fails otherwise).
