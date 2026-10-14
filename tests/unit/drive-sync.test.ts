import assert from "node:assert/strict";
import { test } from "node:test";
import { branchHeads, type DriveFile } from "../../lib/sync/drive";

const file = (id: string, hash: string, parentHash = ""): DriveFile => ({
  id,
  name: `${id}.forgecy.zip`,
  appProperties: { forgecy: "snapshot", hash, parentHash },
});

test("Drive snapshot ancestry identifies one advancing head", () => {
  const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
  assert.deepEqual(branchHeads([file("a", a), file("b", b, a), file("c", c, b)]).map(item => item.id), ["c"]);
});

test("independent snapshots remain as separate conflict branches", () => {
  const root = "a".repeat(64), local = "b".repeat(64), remote = "c".repeat(64);
  assert.deepEqual(branchHeads([file("root", root), file("local", local, root), file("remote", remote, root)]).map(item => item.id).sort(), ["local", "remote"]);
});

test("continuing one selected branch does not erase another branch", () => {
  const root = "a".repeat(64), local = "b".repeat(64), remote = "c".repeat(64), next = "d".repeat(64);
  const heads = branchHeads([file("root", root), file("local", local, root), file("remote", remote, root), file("next-local", next, local)]);
  assert.deepEqual(heads.map(item => item.id).sort(), ["next-local", "remote"]);
});
