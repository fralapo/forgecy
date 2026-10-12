import { afterEach, describe, expect, it, vi } from "vitest";
import { runWebsiteCrawl } from "../src/crawl";
import type { ImportContext, ImportDeps } from "../src/import/run";

afterEach(() => vi.unstubAllEnvs());

describe("runWebsiteCrawl configuration", () => {
  it("fails on a bad FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS before the source is marked as extracting", async () => {
    vi.stubEnv("FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS", "TRUE");
    const source = { id: "s1", clientId: "c1", removedAt: null, url: "https://example.com" };
    const update = vi.fn();
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([source]) }) }),
      update,
    };
    await expect(
      runWebsiteCrawl({ db } as unknown as ImportDeps, {} as ImportContext, {
        clientId: "c1",
        sourceId: "s1",
      }),
    ).rejects.toThrow(/FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS/);
    expect(update).not.toHaveBeenCalled();
  });
});
