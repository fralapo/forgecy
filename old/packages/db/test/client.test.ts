import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/client";

// The pool is lazy: nothing connects to this address.
const URL = "postgres://u:p@127.0.0.1:1/none";

describe("createDb", () => {
  it("handles errors of idle clients instead of crashing the process", async () => {
    const db = createDb(URL);
    expect(db.$client.listenerCount("error")).toBeGreaterThan(0);
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(() => db.$client.emit("error", new Error("terminating connection"))).not.toThrow();
      expect(write).toHaveBeenCalledWith(expect.stringContaining("terminating connection"));
      // The connection string (with its password) never reaches the log.
      expect(String(write.mock.calls[0]?.[0])).not.toContain("u:p@");
    } finally {
      write.mockRestore();
      await db.$client.end();
    }
  });

  it("uses a caller-supplied handler", async () => {
    const onError = vi.fn();
    const db = createDb(URL, { onError });
    const err = new Error("boom");
    db.$client.emit("error", err);
    expect(onError).toHaveBeenCalledWith(err);
    await db.$client.end();
  });
});
