import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInstagramUsername } from "../../lib/instagram-username";

test("normalizes accepted public Instagram handles consistently",()=>{
  assert.equal(normalizeInstagramUsername("@DeoDue.Home"),"deodue.home");
  assert.equal(normalizeInstagramUsername("a".repeat(30)),"a".repeat(30));
  assert.equal(normalizeInstagramUsername("  forgecy_audit  "),"forgecy_audit");
});

test("rejects handles over 30 characters, URLs and unsupported characters",()=>{
  assert.equal(normalizeInstagramUsername("a".repeat(31)),null);
  assert.equal(normalizeInstagramUsername("https://instagram.com/deoduehome"),null);
  assert.equal(normalizeInstagramUsername("forgecy audit"),null);
  assert.equal(normalizeInstagramUsername("@"),null);
});
