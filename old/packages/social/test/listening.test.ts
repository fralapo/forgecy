import { describe, expect, it } from "vitest";
import { signalInputSchema, signalTrigger } from "../src";

describe("listening: input", () => {
  it("keeps the words as written and defaults the platform", () => {
    const s = signalInputSchema.parse({ text: "  Ma si lava in lavatrice?  ", tag: " " });
    expect(s).toMatchObject({ text: "Ma si lava in lavatrice?", platform: "instagram", tag: null });
  });
  it("refuses an empty text, an unknown platform and a link that is not http(s)", () => {
    expect(() => signalInputSchema.parse({ text: " " })).toThrow();
    expect(() => signalInputSchema.parse({ text: "x", platform: "myspace" })).toThrow();
    expect(() => signalInputSchema.parse({ text: "x", url: "javascript:alert(1)" })).toThrow();
    expect(signalInputSchema.parse({ text: "x", url: "" }).url).toBeNull();
  });
});

describe("listening: trigger", () => {
  it("passes a short signal through and cuts a long one at a word within 200", () => {
    expect(signalTrigger("  una   domanda ")).toBe("una domanda");
    const long = signalTrigger("parola ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith("…")).toBe(true);
    expect(long.endsWith("parola…")).toBe(true);
  });
});
