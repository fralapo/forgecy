import { contentStatuses } from "@forgecy/core";
import { createFakeDb, renderSql } from "@forgecy/db/testing";
import { describe, expect, it } from "vitest";
import {
  decideReview,
  isFinalExportable,
  restoreVersion,
  saveDraft,
  unchangedSince,
  withdrawFromReview,
} from "../src/carousels/carousels";

const ID = "00000000-0000-4000-8000-0000000000c1";
const CLIENT = "00000000-0000-4000-8000-0000000000c2";
const USER = "00000000-0000-4000-8000-0000000000c3";
const user = {
  type: "user" as const,
  id: USER,
  isAdmin: false,
  active: true,
  clients: "all" as const,
};

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  clientId: CLIENT,
  status: "draft",
  draftRev: 3,
  title: "T",
  lockedByJobId: null,
  lockExpiresAt: null,
  draftUpdatedBy: null,
  draftUpdatedAt: null,
  ...over,
});
const doc = { title: "T", slides: [], caption: "", hashtags: [] };
const updateWhere = (w: string[]) => w.find((x) => x.startsWith("update"))!;

describe("unchangedSince", () => {
  it("pins id, status and draft revision", () => {
    const q = renderSql(unchangedSince({ id: ID, status: "draft", draftRev: 3 })!);
    expect(q.sql).toBe(
      '("contents"."id" = $1 and "contents"."status" = $2 and "contents"."draft_rev" = $3)',
    );
    expect(q.params).toEqual([ID, "draft", 3]);
  });
});

describe("saveDraft", () => {
  it("cannot overtake a concurrent status change (e.g. submitForReview)", async () => {
    // The row was draft when read; the UPDATE finds it in_review and matches nothing.
    const fake = createFakeDb({ selects: [[row()]], updates: [[]] });
    await expect(
      saveDraft(fake.db, user, { clientId: CLIENT, id: ID, draftRev: 3, document: doc }),
    ).rejects.toMatchObject({ details: { code: "CONFLICT-DRAFT-REV" } });
    const where = updateWhere(fake.wheres);
    expect(where).toContain('"contents"."status" = $');
    expect(where).toContain('"contents"."draft_rev" = $');
  });
});

describe("restoreVersion", () => {
  it("refuses content that is not editable (archived was silently un-archived)", async () => {
    const fake = createFakeDb({ selects: [[row({ status: "archived" })]] });
    await expect(
      restoreVersion(fake.db, user, { clientId: CLIENT, id: ID, number: 1 }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(fake.calls).toEqual(["select"]);
  });

  it("writes only if status and revision are still what it read", async () => {
    const fake = createFakeDb({
      selects: [[row()], [{ number: 1, document: doc }]],
      updates: [[]],
    });
    await expect(
      restoreVersion(fake.db, user, { clientId: CLIENT, id: ID, number: 1 }),
    ).rejects.toMatchObject({ details: { code: "CONFLICT-DRAFT-REV" } });
    const where = updateWhere(fake.wheres);
    expect(where).toContain('"contents"."status" = $');
    expect(where).toContain('"contents"."draft_rev" = $');
  });
});

describe("withdrawFromReview", () => {
  it("cannot undo a decision made in the meantime", async () => {
    const fake = createFakeDb({ selects: [[row({ status: "in_review" })]], updates: [[]] });
    await expect(
      withdrawFromReview(fake.db, user, { clientId: CLIENT, id: ID }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(updateWhere(fake.wheres)).toContain('"contents"."status" = $');
  });
});

describe("decideReview", () => {
  const VERSION = "00000000-0000-4000-8000-0000000000c4";
  it("writes only if the content is still in review AND still on the version being decided", async () => {
    // The brand-guard run between the read and the write can take a while; a new version
    // submitted meanwhile must not inherit the decision about the old one.
    const fake = createFakeDb({
      selects: [
        [
          row({
            status: "in_review",
            currentVersionId: VERSION,
            submittedBy: null,
            createdBy: null,
          }),
        ],
        [{ id: VERSION, number: 2, document: doc }],
      ],
      inserts: [[]],
      updates: [[]],
    });
    await expect(
      decideReview(
        fake.db,
        { ...user, isAdmin: true },
        {
          clientId: CLIENT,
          id: ID,
          versionId: VERSION,
          decision: "changes_requested",
          note: "Fix the title",
        },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const where = updateWhere(fake.wheres);
    expect(where).toContain('"contents"."status" = $');
    expect(where).toContain('"contents"."current_version_id" = $');
  });
});

describe("isFinalExportable", () => {
  it("is true only for approved and exported", () => {
    const ok = contentStatuses.filter((status) => isFinalExportable({ status }));
    expect(ok).toEqual(["approved", "exported"]);
  });
});
