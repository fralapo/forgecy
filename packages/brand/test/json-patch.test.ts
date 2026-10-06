import { describe, expect, it } from "vitest";
import { applyPatch, formatPointer, getAt, JsonPatchError, parsePointer } from "../src/json-patch";

describe("JSON Patch (RFC 6902)", () => {
  const doc = { a: { b: [1, 2, 3] }, "x/y": { "m~n": true } };

  it("parses and formats pointers with escapes", () => {
    expect(parsePointer("/x~1y/m~0n")).toEqual(["x/y", "m~n"]);
    expect(formatPointer(["x/y", "m~n"])).toBe("/x~1y/m~0n");
    expect(getAt(doc, "/x~1y/m~0n")).toBe(true);
  });

  it("applies add, remove, replace, move, copy and test without mutating the input", () => {
    const out = applyPatch(doc, [
      { op: "test", path: "/a/b/0", value: 1 },
      { op: "add", path: "/a/b/-", value: 4 },
      { op: "add", path: "/a/b/0", value: 0 },
      { op: "remove", path: "/a/b/1" },
      { op: "replace", path: "/a/c", value: "no" },
    ].slice(0, 4));
    expect(out.a.b).toEqual([0, 2, 3, 4]);
    expect(doc.a.b).toEqual([1, 2, 3]);
    const moved = applyPatch({ a: 1, b: {} } as Record<string, unknown>, [
      { op: "copy", from: "/a", path: "/c" },
      { op: "move", from: "/a", path: "/b/a" },
    ]);
    expect(moved).toEqual({ b: { a: 1 }, c: 1 });
  });

  it("fails the whole patch when a test does not match", () => {
    expect(() =>
      applyPatch(doc, [
        { op: "test", path: "/a/b/0", value: 9 },
        { op: "replace", path: "/a/b/0", value: 10 },
      ]),
    ).toThrow(JsonPatchError);
    try {
      applyPatch(doc, [{ op: "test", path: "/a/b/0", value: 9 }]);
    } catch (err) {
      expect((err as JsonPatchError).code).toBe("test_failed");
    }
  });

  it("refuses replacing a missing member and out of range indexes", () => {
    expect(() => applyPatch(doc, [{ op: "replace", path: "/nope", value: 1 }])).toThrow(/Nothing to replace/);
    expect(() => applyPatch(doc, [{ op: "add", path: "/a/b/9", value: 1 }])).toThrow(/out of range/);
    expect(() => applyPatch(doc, [{ op: "remove", path: "/a/b/3" }])).toThrow(JsonPatchError);
  });

  it("compares objects deeply in test, ignoring key order", () => {
    expect(() => applyPatch({ o: { a: 1, b: [1] } }, [{ op: "test", path: "/o", value: { b: [1], a: 1 } }])).not.toThrow();
  });
});
