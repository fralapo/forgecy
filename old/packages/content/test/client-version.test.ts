import { describe, expect, it } from "vitest";
import {
  assertClientFiles,
  clientVersionSchema,
  readClientVersion,
  type ClientFile,
} from "../src/carousels/client-version";

const png: ClientFile = { bytes: new Uint8Array([1]), mime: "image/png", name: "s1.png" };
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n");
const pdf: ClientFile = { bytes: pdfBytes, mime: "application/pdf", name: "v.pdf" };

describe("client version validators", () => {
  it("needs at least one file", () => {
    expect(() => assertClientFiles({ slides: [] })).toThrow();
    expect(() => assertClientFiles({ slides: [png] })).not.toThrow();
    expect(() => assertClientFiles({ slides: [], pdf })).not.toThrow();
  });
  it("caps slides at 20", () => {
    expect(() => assertClientFiles({ slides: Array(20).fill(png) })).not.toThrow();
    expect(() => assertClientFiles({ slides: Array(21).fill(png) })).toThrow();
  });
  it("accepts images only for slides and a real PDF for the PDF", () => {
    expect(() => assertClientFiles({ slides: [{ ...png, mime: "image/gif" }] })).toThrow();
    expect(() => assertClientFiles({ slides: [], pdf: { ...pdf, mime: "image/png" } })).toThrow();
    expect(() =>
      assertClientFiles({ slides: [], pdf: { ...pdf, bytes: new TextEncoder().encode("hello") } }),
    ).toThrow();
  });
  it("reads stored data and ignores what is not a client version", () => {
    expect(readClientVersion(null)).toBeNull();
    expect(readClientVersion({ nope: true })).toBeNull();
    const ok = clientVersionSchema.parse({
      attachedAt: "2026-10-11T10:00:00.000Z",
      attachedBy: "0f0c8a2e-5d41-4f55-9a07-0f3d2f6c9b11",
    });
    expect(ok).toMatchObject({ slideAssetIds: [], pdf: null, notes: [] });
  });
});
