import assert from "node:assert/strict";
import test from "node:test";
import { resolveMissionOffer } from "../../lib/mission-offer";

test("uses the selected offer already in the bounded AI context", async () => {
  const selected = { id: "offer-a", name: "A" };
  let loaded = false;
  const result = await resolveMissionOffer([selected], "offer-a", async () => {
    loaded = true;
    return null;
  });

  assert.equal(result, selected);
  assert.equal(loaded, false);
});

test("loads a verified selected offer omitted from the bounded AI context", async () => {
  const selected = { id: "offer-b", name: "B" };
  const requested: string[] = [];
  const result = await resolveMissionOffer([{ id: "offer-a", name: "A" }], "offer-b", async (id) => {
    requested.push(id);
    return selected;
  });

  assert.equal(result, selected);
  assert.deepEqual(requested, ["offer-b"]);
});

test("an omitted or unresolvable offer stays unselected", async () => {
  const requested: string[] = [];
  const noSelection = await resolveMissionOffer([], null, async (id) => {
    requested.push(id);
    return null;
  });
  const missingSelection = await resolveMissionOffer([], "missing", async (id) => {
    requested.push(id);
    return null;
  });

  assert.equal(noSelection, null);
  assert.equal(missingSelection, null);
  assert.deepEqual(requested, ["missing"]);
});
