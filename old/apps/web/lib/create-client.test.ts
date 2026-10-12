import { PermissionDeniedError, type Actor } from "@forgecy/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getDb = vi.fn(() => {
  throw new Error("the database must not be touched");
});
vi.mock("@forgecy/db", () => ({
  getDb,
  clients: {},
  eq: vi.fn(),
  grantClientAccess: vi.fn(),
  recordAuditEvent: vi.fn(),
}));
vi.mock("@forgecy/ai", () => ({ getDefaultAiPolicy: vi.fn() }));
vi.mock("@forgecy/brand", () => ({ brandCrawlWebsiteJob: {}, findOrCreateWebsiteSource: vi.fn() }));
vi.mock("@forgecy/jobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("./queues", () => ({ getQueues: vi.fn() }));
vi.mock("./i18n", () => ({ vmsg: (key: string) => key }));

const { createClientFor } = await import("./create-client");

const user = (actor: Actor) => ({ id: "u1", actor }) as never;
const input = { name: "Acme", status: "prospect" as const, websiteUrl: "https://acme.test" };

describe("createClientFor", () => {
  it("refuses a deactivated person before touching anything", async () => {
    const actor: Actor = { type: "user", id: "u1", isAdmin: false, active: false, clients: [] };
    await expect(createClientFor(user(actor), input)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses an agent", async () => {
    const actor: Actor = { type: "agent", role: "brand_analyst" };
    await expect(createClientFor(user(actor), input)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(getDb).not.toHaveBeenCalled();
  });
});
