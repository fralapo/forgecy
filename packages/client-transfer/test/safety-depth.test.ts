import { describe, expect, it } from "vitest";
import type { PackageManifest } from "../src/export";
import { clientTables } from "../src/graph";
import type { ClientPackage } from "../src/package";
import {
  assertPackageData,
  assertPackageScoped,
  mapStrings,
  remapRows,
  UnsafePackageError,
  type Row,
} from "../src/safety";

const ME = "11111111-1111-4111-8111-11111111111a";
const ROW = "22222222-2222-4222-8222-22222222222c";
const contents = clientTables().find((t) => t.name === "contents")!;

/** `n` arrays around a string, built as text so nothing here recurses. */
const nestedText = (n: number, leaf = '"x"') => "[".repeat(n) + leaf + "]".repeat(n);
const nested = (n: number): unknown => JSON.parse(nestedText(n));

const scoped = (rows: Row[]) =>
  assertPackageScoped([contents], new Map([["contents", rows]]), {
    clientId: ME,
    idsByTable: new Map([["clients", new Set([ME])]]),
    areas: new Set(["client", "content"]),
  });
const row = (draft: unknown): Row => ({ id: ROW, client_id: ME, title: "t", draft });
const problemOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof UnsafePackageError ? err.problem : `other: ${String(err)}`;
  }
  return "none";
};

describe("JSON nesting depth", () => {
  // The row object is level 1, so `draft` holding n arrays reaches level n + 1.
  it("accepts 64 levels", () => {
    expect(problemOf(() => scoped([row(nested(63))]))).toBe("none");
  });
  it("refuses 65 levels as unsafe", () => {
    expect(problemOf(() => scoped([row(nested(64))]))).toBe("unsafe");
  });
  it("refuses 10 000 levels as unsafe, not as a RangeError", () => {
    expect(problemOf(() => scoped([row(nested(10_000))]))).toBe("unsafe");
    expect(problemOf(() => remapRows(`[${nestedText(10_000)}]`, new Map()))).toBe("unsafe");
    expect(problemOf(() => mapStrings(nested(10_000), (s) => s))).toBe("unsafe");
  });
  it("counts the JSON stored inside a string column too", () => {
    expect(problemOf(() => scoped([row(nestedText(100))]))).toBe("unsafe");
    expect(problemOf(() => scoped([row(nestedText(10))]))).toBe("none");
  });
  it("counts nesting through objects and through nested JSON strings together", () => {
    // 40 levels of object + a string that holds 40 more
    const inner = nestedText(40);
    let v: unknown = inner;
    for (let i = 0; i < 40; i++) v = { k: v };
    expect(problemOf(() => scoped([row(v)]))).toBe("unsafe");
  });

  it("reaches assertPackageData with a deep table as unsafe", async () => {
    const text = (name: string) =>
      name === "data/clients.json"
        ? JSON.stringify([{ id: ME, name: "a", slug: "a" }])
        : `[{"id":"${ROW}","client_id":"${ME}","title":"t","draft":${nestedText(10_000)}}]`;
    const pkg = {
      names: () => [],
      has: (n: string) => n === "data/clients.json" || n === "data/contents.json",
      text: async (n: string) => text(n),
      stream: () => Promise.reject(new Error("x")),
      sha256: () => Promise.reject(new Error("x")),
      close: () => {},
    } as ClientPackage;
    const manifest = { client: { id: ME, name: "a", slug: "a" }, areas: ["content"], files: [] };
    await expect(assertPackageData(pkg, manifest as unknown as PackageManifest)).rejects.toThrow(
      UnsafePackageError,
    );
  });
});

describe("a wide but shallow package is still fast", () => {
  it("walks about 1 MB of strings in well under 2 seconds", () => {
    const rows: Row[] = Array.from({ length: 5000 }, (_, i) =>
      row({
        id: i,
        tags: Array.from({ length: 10 }, (_, j) => `tag-${i}-${j}-xxxxx`),
        meta: { a: "alpha value", b: "beta value", note: "n".repeat(30) },
      }),
    );
    expect(JSON.stringify(rows).length).toBeGreaterThan(1_000_000);
    const started = performance.now();
    scoped(rows);
    remapRows(JSON.stringify(rows), new Map());
    expect(performance.now() - started).toBeLessThan(2000);
  });
  it("is not quadratic in the depth that is allowed", () => {
    const rows = Array.from({ length: 2000 }, () => row(nested(60)));
    const started = performance.now();
    scoped(rows);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
