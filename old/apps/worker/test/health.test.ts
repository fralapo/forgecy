import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Database } from "@forgecy/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startHealthServer } from "../src/health";

let server: Server | undefined;
afterEach(
  () =>
    new Promise<void>((done) => {
      if (server) server.close(() => done());
      else done();
    }),
);

async function start(execute: () => Promise<unknown>, running = () => true) {
  const db = { execute: vi.fn(execute) } as unknown as Database;
  server = startHealthServer(0, db, running);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("worker /health", () => {
  it("is 200 when the database answers and the loop is up", async () => {
    const base = await start(async () => ({ rows: [] }));
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "worker", db: "ok" });
  });

  it("is 503 when the database is unreachable", async () => {
    const base = await start(async () => {
      throw new Error("connection refused");
    });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "error", db: "unreachable" });
  });

  it("is 503 once the worker is shutting down", async () => {
    const base = await start(
      async () => ({ rows: [] }),
      () => false,
    );
    expect((await fetch(`${base}/health`)).status).toBe(503);
  });

  it("answers 404 on any other path", async () => {
    const base = await start(async () => ({ rows: [] }));
    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});
