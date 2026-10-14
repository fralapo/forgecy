import test from "node:test";
import assert from "node:assert/strict";
import { planLinkedOfferCleanup } from "../../lib/source-management";

test("source deletion removes unused draft offers and detaches preserved offers", () => {
  const result = planLinkedOfferCleanup([
    { id: "unused-draft", status: "draft" },
    { id: "referenced-draft", status: "draft" },
    { id: "verified", status: "verified" },
    { id: "archived", status: "archived" },
  ], new Set(["referenced-draft"]));

  assert.deepEqual(result, {
    deleteIds: ["unused-draft"],
    detachIds: ["referenced-draft", "verified", "archived"],
  });
});

test("source deletion handles an empty set of linked offers", () => {
  assert.deepEqual(planLinkedOfferCleanup([], new Set()), { deleteIds: [], detachIds: [] });
});
