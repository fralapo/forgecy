import type { Actor } from "@forgecy/core";
import { createDb, type Database } from "@forgecy/db";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAiGateway,
  createFakeTextProvider,
  createMemoryLedger,
  previewAgentInstructions,
  type Routing,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("try instructions on an example (integration)", () => {
  let db: Database;
  const admin: Actor = {
    type: "user",
    id: "00000000-0000-4000-8000-0000000000aa",
    isAdmin: true,
    active: true,
  };
  const member: Actor = { ...admin, isAdmin: false };
  const routing: Routing = { default: { primary: { provider: "anthropic", model: "m" } } };

  beforeAll(() => {
    db = createDb(dbUrl!, { max: 2 });
  });

  it("runs the draft on the example with no client, Admins only", async () => {
    const ledger = createMemoryLedger();
    const anthropic = createFakeTextProvider("anthropic");
    const gateway = createAiGateway({
      ledger,
      providers: { text: { anthropic }, image: {} },
      routing,
    });
    anthropic.push({ json: { output: "Slide 1: Hello", followed: ["No emoji"] } });
    const input = {
      task: "slides",
      example: "A brief about coffee",
      text: "Never use emoji.",
      version: 2,
    };
    const res = await previewAgentInstructions({ db, gateway }, admin, "copywriter", input);
    expect(res).toMatchObject({ output: "Slide 1: Hello", followed: ["No emoji"] });
    expect(anthropic.calls[0]!.system).toContain("Never use emoji.");
    expect(ledger.entries[0]).toMatchObject({
      clientId: null,
      authorizedBy: admin.type === "user" ? admin.id : null,
    });

    await expect(
      previewAgentInstructions({ db, gateway }, member, "copywriter", input),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      previewAgentInstructions({ db, gateway }, admin, "copywriter", { ...input, task: "scan" }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});
