import { describe, expect, it } from "vitest";
import {
  aiRoutingSettingsSchema,
  createAiGateway,
  createFakeTextProvider,
  resolveRouting,
  type ImageProvider,
  type ProviderSet,
  type RoutingEnv,
} from "../src/index";

const env = {
  AI_DEFAULT_PROVIDER: "anthropic",
  LOCAL_LLM_ENABLED: false,
  OPENROUTER_API_KEY: "o",
  HIGGSFIELD_IMAGE_MODEL: "flux_2",
} as RoutingEnv;

const image = (id: ImageProvider["id"]): ImageProvider => ({
  id,
  generate: async () => ({ jobId: "j", state: "failed" }),
  getStatus: async (jobId) => ({ jobId, state: "failed" }),
});

const providers: ProviderSet = {
  text: {
    anthropic: createFakeTextProvider("anthropic"),
    openrouter: createFakeTextProvider("openrouter"),
  },
  image: {
    openrouter: image("openrouter"),
    higgsfield: image("higgsfield"),
    openai: image("openai"),
  },
};

describe("Admin routing settings", () => {
  it("uses the chosen text service and model, with a fallback", () => {
    const { routing } = resolveRouting(env, providers, {
      text: {
        provider: "openrouter",
        model: "deepseek/deepseek-chat",
        fallback: { provider: "anthropic", model: "" },
      },
    });
    expect(routing.default.primary).toEqual({
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
    });
    expect(routing.default.fallback?.provider).toBe("anthropic");
    expect(routing.default.fallback?.model).toBeTruthy();
  });

  it("falls back to the env default when the chosen service is not configured", () => {
    const { routing } = resolveRouting(env, providers, {
      text: { provider: "deepseek", model: "deepseek-flash" },
    });
    expect(routing.default.primary.provider).toBe("anthropic");
  });

  it("orders images as chosen, skips unconnected MCP and switched-off services", () => {
    const settings = {
      images: [
        { provider: "higgsfield" as const, model: "" },
        { provider: "openrouter" as const, model: "black-forest-labs/flux.2-pro" },
      ],
    };
    const off = resolveRouting(env, providers, settings);
    expect(off.images).toEqual([{ provider: "openrouter", model: "black-forest-labs/flux.2-pro" }]);
    const on = resolveRouting(env, providers, settings, new Set(["higgsfield"]));
    expect(on.images.map((i) => i.provider)).toEqual(["higgsfield", "openrouter"]);
    expect(on.routing.image?.primary).toEqual({ provider: "higgsfield", model: "flux_2" });
    expect(on.routing.image?.fallback?.provider).toBe("openrouter");
  });

  it("rejects a service listed twice", () => {
    expect(
      aiRoutingSettingsSchema.safeParse({
        images: [
          { provider: "openai", model: "" },
          { provider: "openai", model: "x" },
        ],
      }).success,
    ).toBe(false);
  });

  it("the gateway reads a routing function before each request", async () => {
    let calls = 0;
    const gateway = createAiGateway({
      ledger: {
        record: async () => undefined,
        monthSpendMicroUsd: async () => 0,
        budgetFor: async () => null,
      },
      providers,
      routing: async () => {
        calls++;
        return { default: { primary: { provider: "openrouter", model: "x/y" } } };
      },
    });
    expect(calls).toBe(0);
    await gateway
      .generateObject({
        task: "test",
        schema: aiRoutingSettingsSchema,
        system: "s",
        input: "i",
        clientPolicy: "external_allowed",
      })
      .catch(() => undefined);
    expect(calls).toBe(1);
  });
});
