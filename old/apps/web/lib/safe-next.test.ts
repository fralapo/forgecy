import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps ordinary same-site paths with query and hash unchanged", () => {
    expect(safeNext("/clients")).toBe("/clients");
    expect(safeNext("/content")).toBe("/content");
    expect(safeNext("/content?x=1#y")).toBe("/content?x=1#y");
    expect(safeNext("/audit/abc")).toBe("/audit/abc");
    expect(safeNext("/content/acme?tab=drafts#top")).toBe("/content/acme?tab=drafts#top");
    expect(safeNext("/a/../b")).toBe("/b");
  });

  it("falls back to / for missing, empty or non-string values", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
    for (const odd of [42, {}, [], ["/clients"], true])
      expect(safeNext(odd as never), JSON.stringify(odd)).toBe("/");
  });

  it("rejects every form that browsers resolve to another origin", () => {
    for (const hostile of [
      "//evil.com",
      "///evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "\\\\evil.com",
      "\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/\t\t/evil.com",
      "https://evil.com",
      "http://evil.com/login",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "evil.com",
      "  //evil.com",
      " /clients",
      "\t/clients",
      "\u0000/clients",
      "\u0001//evil.com",
    ])
      expect(safeNext(hostile), JSON.stringify(hostile)).toBe("/");
  });

  it("never returns a protocol-relative path after dot-segment normalisation", () => {
    for (const hostile of ["/..//evil.com", "/.//evil.com", "/a/..//evil.com", "/%2e%2e//evil.com"])
      expect(safeNext(hostile), JSON.stringify(hostile)).toBe("/");
  });

  it("keeps percent-encoded slashes as plain path characters", () => {
    expect(safeNext("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
    expect(safeNext("/%09/evil.com")).toBe("/%09/evil.com");
  });

  it("rejects very long input", () => {
    expect(safeNext("/" + "a".repeat(5000))).toBe("/");
  });
});
