# Agents

Each file describes one Forgecy AI agent: role, input, output and constraints. The instructions are versioned here; memory stays in the database. No agent can approve or publish: it proposes and leaves the decision to a person.

The know-how agents share (copywriting craft, positioning, organic social, image prompting, website review) lives as short playbooks in `packages/ai/src/playbooks/`, appended to each agent's system prompt with `withPlaybooks()`. The agent's own rules always come first and prevail. See [ADR 0007](../adr/0007-agent-playbooks.md).
