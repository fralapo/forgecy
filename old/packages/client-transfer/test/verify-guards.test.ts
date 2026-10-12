import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@forgecy/db";
import { zipArchive } from "@forgecy/core/testing/archives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClientPackage } from "../src/package";
import { assertPackageData, UnsafePackageError } from "../src/safety";
import { verifyClientPackage } from "../src/verify";

// Everything here is refused before the database is touched.
const noDb = {} as Database;

describe("verifyClientPackage reports a hostile package as unsafe, not unreadable", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "forgecy-verify-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const verify = (zip: Buffer | string) => {
    const file = join(dir, "p.zip");
    writeFileSync(file, zip);
    return verifyClientPackage(noDb, file, 1);
  };

  it("a zip-slip entry name", async () => {
    expect((await verify(zipArchive([{ name: "../evil", data: "x" }]))).problems).toEqual([
      "unsafe",
    ]);
  });
  it("a manifest over the JSON cap", async () => {
    const big = zipArchive([{ name: "manifest.json", data: Buffer.alloc(65 * 1024 * 1024, 32) }]);
    expect((await verify(big)).problems).toEqual(["unsafe"]);
  });
  it("still calls plain garbage unreadable, and a missing manifest a format problem", async () => {
    expect((await verify("not a zip")).problems).toEqual(["unreadable"]);
    expect((await verify(zipArchive([{ name: "x.json", data: "{}" }]))).problems).toEqual([
      "format",
    ]);
  });
});

describe("assertPackageData table reads", () => {
  const manifest = {
    client: { id: "11111111-1111-4111-8111-11111111111a", name: "a", slug: "a" },
    areas: [],
    files: [],
  };
  const packageThrowing = (err: Error): ClientPackage => ({
    names: () => [],
    has: (n) => n === "data/clients.json",
    text: async () => {
      throw err;
    },
    stream: () => Promise.reject(new Error("x")),
    sha256: () => Promise.reject(new Error("x")),
    close: () => {},
  });
  const problemOf = async (err: Error) => {
    try {
      await assertPackageData(packageThrowing(err), manifest as never);
    } catch (e) {
      return e instanceof UnsafePackageError ? e.problem : `other: ${String(e)}`;
    }
    return "none";
  };
  it("lets an unsafe refusal through as unsafe", async () => {
    expect(await problemOf(new UnsafePackageError("data/clients.json is too large to read"))).toBe(
      "unsafe",
    );
  });
  it("keeps any other read failure as unreadable", async () => {
    expect(await problemOf(new Error("inflate failed"))).toBe("unreadable");
  });
});
