import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentRoles } from "@forgecy/core";
import {
  AGENT_CAPABILITIES,
  AGENT_ORDER,
  AGENT_TASKS,
  agentForTask,
  aiTasks,
  createAiGateway,
  createFakeImageProvider,
  createFakeTextProvider,
  createMemoryLedger,
  withAgents,
  type AgentConfig,
  type Routing,
} from "../src/index";

const schema = z.object({ title: z.string() });
const routing: Routing = {
  default: {
    primary: { provider: "anthropic", model: "claude-opus-5-5" },
    fallback: { provider: "openai", model: "gpt-6.1-sol" },
  },
  image: { primary: { provider: "openai", model: "gpt-image-2" } },
};

function setup(agents: Routing["agents"]) {
  const ledger = createMemoryLedger();
  const anthropic = createFakeTextProvider("anthropic");
  const openai = createFakeTextProvider("openai");
  const gateway = createAiGateway({
    ledger,
    providers: {
      text: { anthropic, openai },
      image: { openai: createFakeImageProvider("openai") },
    },
    routing: { ...routing, agents },
    now: () => new Date("2026-10-06T10:00:00Z"),
  });
  return { ledger, anthropic, openai, gateway };
}

const req = {
  task: "slides" as const,
  schema,
  system: "You write slide texts.",
  input: "brief",
  clientPolicy: "external_allowed" as const,
};

describe("agent registry", () => {
  it("covers every agent and gives each AI task one owner", () => {
    expect([...AGENT_ORDER].sort()).toEqual([...agentRoles].sort());
    for (const task of aiTasks.filter((t) => t !== "test"))
      expect(agentForTask(task), task).toBeDefined();
    const all = agentRoles.flatMap((a) => AGENT_TASKS[a]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("never lists approve, publish or archive", () => {
    for (const a of agentRoles)
      for (const c of AGENT_CAPABILITIES[a])
        expect(["view", "propose", "generate", "check"]).toContain(c);
  });
});

describe("gateway with agent configuration", () => {
  it("refuses a switched-off agent before any provider call", async () => {
    const { gateway, ledger, anthropic } = setup({ copywriter: { active: false } });
    await expect(gateway.generateObject(req)).rejects.toMatchObject({
      code: "policy_blocked",
      details: { reason: "agent_disabled", agent: "copywriter" },
    });
    expect(anthropic.calls).toHaveLength(0);
    expect(ledger.entries[0]).toMatchObject({ status: "blocked", kind: "slides" });
  });

  it("blocks images when the Art Director is off", async () => {
    const { gateway } = setup({ art_director: { active: false } });
    await expect(
      gateway.generateImage({
        prompt: "x",
        size: { w: 1080, h: 1080 },
        variants: 1,
        clientPolicy: "external_allowed",
      }),
    ).rejects.toMatchObject({ code: "policy_blocked" });
  });

  it("appends published instructions after the module prompt and records the version", async () => {
    const { gateway, anthropic, ledger } = setup({
      copywriter: { active: true, instructions: { version: 3, text: "Never use emoji." } },
    });
    anthropic.push({ json: { title: "Hi" } });
    await gateway.generateObject(req);
    const system = anthropic.calls[0]!.system;
    expect(system.startsWith("You write slide texts.")).toBe(true);
    expect(system).toContain("version 3");
    expect(system).toContain("Never use emoji.");
    expect(ledger.entries[0]!.inputSummary).toMatchObject({
      agent: { key: "copywriter", instructionsVersion: 3 },
    });
  });

  it("uses the agent's model for its task, and the caller's agent when given", async () => {
    const tasks = { slides: { primary: { provider: "openai" as const, model: "gpt-mini" } } };
    const { gateway, anthropic, openai } = setup({ copywriter: { active: true, tasks } });
    openai.push({ json: { title: "Hi" } });
    anthropic.push({ json: { title: "Hi" } });
    await gateway.generateObject(req);
    expect(openai.calls[0]!.model).toBe("gpt-mini");
    // The same task run by another agent does not take the Copywriter's model.
    await gateway.generateObject({ ...req, agent: "strategist" });
    expect(anthropic.calls).toHaveLength(1);
  });
});

describe("gateway with draft instructions (try on an example)", () => {
  it("uses the given instructions instead of the published ones and marks the run", async () => {
    const { gateway, anthropic, ledger } = setup({
      copywriter: { active: true, instructions: { version: 3, text: "Published text." } },
    });
    anthropic.push({ json: { title: "Hi" } });
    await gateway.generateObject({ ...req, instructions: { version: 4, text: "Draft text." } });
    const system = anthropic.calls[0]!.system;
    expect(system).toContain("Draft text.");
    expect(system).not.toContain("Published text.");
    expect(ledger.entries[0]!.inputSummary).toMatchObject({
      agent: { key: "copywriter", instructionsVersion: 4, preview: true },
    });
  });
});

describe("gateway with client memory", () => {
  it("adds the client's approved memories after the instructions and records their ids", async () => {
    const ledger = Object.assign(createMemoryLedger(), {
      agentMemory: async (clientId: string, agent: string) =>
        clientId === "c1" && agent === "copywriter"
          ? [{ id: "m1", version: 2, content: "No rhetorical  questions\nin titles." }]
          : [],
    });
    const anthropic = createFakeTextProvider("anthropic");
    const gateway = createAiGateway({
      ledger,
      providers: { text: { anthropic }, image: {} },
      routing: {
        ...routing,
        agents: { copywriter: { active: true, instructions: { version: 1, text: "Short." } } },
      },
    });
    anthropic.push({ json: { title: "Hi" } });
    anthropic.push({ json: { title: "Hi" } });
    await gateway.generateObject({ ...req, clientId: "c1" });
    const system = anthropic.calls[0]!.system;
    expect(system.indexOf("Short.")).toBeLessThan(system.indexOf("Client memory"));
    expect(system).toContain("- No rhetorical questions in titles.");
    expect(ledger.entries[0]!.inputSummary).toMatchObject({ memory: [{ id: "m1", version: 2 }] });
    // Another client: nothing added, nothing recorded.
    await gateway.generateObject({ ...req, clientId: "c2" });
    expect(anthropic.calls[1]!.system).not.toContain("Client memory");
    expect(ledger.entries[1]!.inputSummary).not.toHaveProperty("memory");
  });
});

describe("withAgents", () => {
  const config = (over: Partial<AgentConfig>): AgentConfig => ({
    agent: "copywriter",
    active: true,
    routes: {},
    published: null,
    draft: null,
    history: [],
    updatedAt: null,
    ...over,
  });
  const configs = Object.fromEntries(agentRoles.map((a) => [a, config({ agent: a })])) as Record<
    (typeof agentRoles)[number],
    AgentConfig
  >;
  const providers = {
    text: { anthropic: createFakeTextProvider("anthropic") },
    image: {},
  };

  it("keeps a task model only when its service is configured and the task is the agent's", () => {
    const out = withAgents(
      routing,
      {
        ...configs,
        copywriter: config({
          routes: {
            slides: { provider: "anthropic", model: "" },
            outline: { provider: "openai", model: "x" },
            scan: { provider: "anthropic", model: "y" },
          },
        }),
      },
      providers,
      {},
    );
    const tasks = out.agents?.copywriter?.tasks;
    expect(tasks?.slides?.primary.provider).toBe("anthropic");
    expect(tasks?.slides?.primary.model).toBeTruthy();
    expect(tasks?.outline).toBeUndefined();
    expect(tasks?.scan).toBeUndefined();
  });
});
