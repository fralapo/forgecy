import { describe, expect, it } from "vitest";
import { createFormat, getTranslator, negotiateLocale } from "../src";

describe("negotiateLocale", () => {
  it.each([
    ["it-IT,it;q=0.9,en;q=0.8", "it"],
    ["en-US,en;q=0.9", "en"],
    ["de-DE,de;q=0.9,it;q=0.5", "it"],
    ["fr-FR", "en"],
    ["", "en"],
    [null, "en"],
    ["it;q=0,en", "en"],
  ])("%s → %s", (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });
});

describe("createFormat", () => {
  const date = new Date("2026-10-06T12:05:00Z");
  it("formats dates the British way in English and the Italian way in Italian", () => {
    expect(createFormat("en", "UTC").date(date)).toBe("6 Oct 2026");
    expect(createFormat("it", "UTC").date(date)).toBe("6 ott 2026");
  });
  it("formats numbers per language", () => {
    expect(createFormat("en").number(1234.5)).toBe("1,234.5");
    expect(createFormat("it").number(1234.5)).toBe("1234,5");
  });
});

describe("getTranslator", () => {
  it("renders ICU plurals in each language", async () => {
    const en = await getTranslator("en", "mail");
    const it = await getTranslator("it", "mail");
    expect(en("magicLink.expires", { minutes: 1 })).toContain("1 minute.");
    expect(it("magicLink.expires", { minutes: 15 })).toContain("15 minuti.");
  });
});

describe("localizedError", async () => {
  const { localizedError } = await import("../src");
  it("carries the English message and a reference for the interface", () => {
    const err = localizedError("permission_denied", "adminOnly");
    expect(err.message).toBe("This setting is reserved for Admin users.");
    expect(err.ref).toEqual({ key: "adminOnly" });
    expect(err.code).toBe("permission_denied");
  });
});
