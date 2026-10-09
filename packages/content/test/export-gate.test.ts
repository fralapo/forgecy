import { createFakeDb } from "@forgecy/db/testing";
import { NeedsAttentionError, type JobContext } from "@forgecy/jobs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renderer = vi.fn(async () => ({ files: [], issues: [], warnings: [] }));
const recordExport = vi.fn(async () => ({ id: "e1" }));

vi.mock("@forgecy/carousel/export", () => ({
  carouselWorkerHandlers: () => ({ "carousel.export": renderer }),
}));
vi.mock("@forgecy/carousel", async (orig) => ({
  ...(await orig<object>()),
  carouselExportPayloadSchema: { parse: (x: unknown) => x },
}));
vi.mock("../src/wiring", () => ({ registerContentPorts: () => undefined }));
vi.mock("../src/carousels/theme", () => ({
  loadBrand: async () => ({ theme: {}, identity: { number: 1 } }),
}));
vi.mock("../src/carousels/carousels", async (orig) => ({
  ...(await orig<object>()),
  recordExport,
}));

const { contentHandlers } = await import("../src/handlers");

const ID = "00000000-0000-4000-8000-0000000000c1";
const CLIENT = "00000000-0000-4000-8000-0000000000c2";
const VERSION = "00000000-0000-4000-8000-0000000000c4";

const content = (status: string) => ({
  id: ID,
  clientId: CLIENT,
  status,
  approvedVersionId: VERSION, // survives a reopen, so only the status tells it is not approved
  title: "T",
  language: "en",
  templateKey: "t",
  templateVersion: null,
  brandVersionId: null,
});
const version = {
  id: VERSION,
  contentId: ID,
  number: 1,
  document: { title: "T", slides: [], caption: "", hashtags: [] },
  meta: {},
  brandVersionId: null,
};

function run(status: string, draft = false) {
  // selects: client, content, version, latest approval
  const fake = createFakeDb({
    selects: [[{ id: CLIENT, name: "C" }], [content(status)], [version], []],
  });
  const ctx = { db: fake.db, jobId: "j1" } as unknown as JobContext;
  const payload = { clientId: CLIENT, contentId: ID, versionId: VERSION, draft, outputs: ["zip"] };
  return contentHandlers["content.export"]!(payload, ctx);
}

describe("export job re-checks the approval gate when it runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a final export of content that was reopened after it was requested", async () => {
    const err = await run("draft").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsAttentionError);
    expect((err as NeedsAttentionError).ref).toMatchObject({
      key: "content.jobErrors.notApproved",
    });
    expect(renderer).not.toHaveBeenCalled();
    expect(recordExport).not.toHaveBeenCalled();
  });

  it("exports when the content is still approved", async () => {
    await run("approved");
    expect(renderer).toHaveBeenCalledOnce();
    expect(recordExport).toHaveBeenCalledOnce();
  });

  it("does not apply the gate to draft exports", async () => {
    await run("draft", true);
    expect(renderer).toHaveBeenCalledOnce();
  });
});
