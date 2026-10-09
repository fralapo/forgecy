import { describe, expect, it } from "vitest";
import { carouselHandlers } from "../src/export/handler";
import { packageFromFiles } from "../src/package";
import { miniPackage } from "./helpers";

const run = (templates: { get: () => Promise<unknown> }, payload: object) => {
  const handlers = carouselHandlers({
    storage: {} as never,
    browser: async () => {
      throw new Error("the browser must not be needed for these errors");
    },
    templates: templates as never,
  });
  return handlers["carousel.export"](payload as never, {} as never);
};

describe("export errors carry a message reference", () => {
  it("unknown template", async () => {
    await expect(run({ get: async () => undefined }, { templateId: "mini" })).rejects.toMatchObject(
      {
        name: "NeedsAttentionError",
        message: "Template mini not found.",
        ref: { key: "jobs.errors.templateIdNotFound", values: { id: "mini" } },
      },
    );
  });

  it("unknown template version", async () => {
    await expect(
      run({ get: async () => undefined }, { templateId: "mini", templateVersion: "2.0.0" }),
    ).rejects.toMatchObject({
      message: "Template mini v2.0.0 not found.",
      ref: { key: "jobs.errors.templateVersionNotFound", values: { id: "mini", version: "2.0.0" } },
    });
  });

  it("slides that do not fit the template", async () => {
    await expect(
      run(
        { get: async () => packageFromFiles(miniPackage()) },
        { templateId: "mini-test", slides: [] },
      ),
    ).rejects.toMatchObject({
      name: "NeedsAttentionError",
      ref: { key: "jobs.errors.slidesInvalid" },
    });
  });
});
