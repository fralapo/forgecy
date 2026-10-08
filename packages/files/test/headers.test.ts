import { describe, expect, it } from "vitest";
import { fileResponseHeaders } from "../src/headers";

describe("fileResponseHeaders", () => {
  it("sandboxes SVG, which can carry scripts", () => {
    const h = fileResponseHeaders("image/svg+xml");
    expect(h["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(h["x-content-type-options"]).toBe("nosniff");
  });
  it("matches SVG with parameters and any case", () => {
    expect(fileResponseHeaders("IMAGE/SVG+XML; charset=utf-8")["content-security-policy"]).toContain("sandbox");
  });
  it("leaves raster images and PDFs free of a sandbox (a sandboxed PDF will not render in Chrome)", () => {
    for (const type of ["image/png", "application/pdf", "application/octet-stream"]) {
      const h = fileResponseHeaders(type);
      expect(h["content-security-policy"]).toBeUndefined();
      expect(h["x-content-type-options"]).toBe("nosniff");
    }
  });
});
