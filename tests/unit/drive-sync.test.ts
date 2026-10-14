import assert from "node:assert/strict";
import { test } from "node:test";
import { branchHeads, readBoundedResponseBody, withDriveReadRetries, type DriveFile } from "../../lib/sync/drive";

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

test("Drive reads retry transient HTTP and network failures", async () => {
  let calls = 0;
  const response = await withDriveReadRetries(async () => {
    calls++;
    if (calls === 1) return new Response("temporary", { status: 503 });
    return new Response("ok", { status: 200 });
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);

  calls = 0;
  const afterNetworkFailure = await withDriveReadRetries(async () => {
    calls++;
    if (calls === 1) throw new TypeError("network down");
    return new Response("ok", { status: 200 });
  });
  assert.equal(afterNetworkFailure.status, 200);
  assert.equal(calls, 2);
});

test("Drive archive download enforces its limit while streaming without a length header", async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(5));
      controller.close();
    },
  }));
  await assert.rejects(readBoundedResponseBody(response, 8), { status: 413 });
});

test("Drive archive download accepts a body under its limit", async () => {
  const body = await readBoundedResponseBody(new Response(new Uint8Array([1, 2, 3])), 3);
  assert.deepEqual([...body], [1, 2, 3]);
});
