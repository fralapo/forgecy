import { describe, expect, it } from "vitest";
import type { Ctl } from "./editor-config";
import { entrySummary } from "./entry-summary";

const message: Ctl[] = [
  { kind: "select", key: "kind", label: "strategy.messageType", options: [], required: true },
  { kind: "textarea", key: "text", label: "strategy.messageText" },
  { kind: "textarea", key: "proof", label: "strategy.proof" },
];

describe("entrySummary", () => {
  it("labels a message by its text, never by its type menu", () => {
    expect(entrySummary({ kind: "claim", text: "Il profumo resta nei giorni" }, message)).toBe(
      "Il profumo resta nei giorni",
    );
  });

  it("skips empty text boxes and takes the next one", () => {
    expect(entrySummary({ kind: "claim", text: "  ", proof: "Test di laboratorio" }, message)).toBe(
      "Test di laboratorio",
    );
  });

  it("is null for a new, empty entry (so it opens unfolded)", () => {
    expect(entrySummary({}, message)).toBeNull();
    expect(entrySummary({ kind: "claim" }, message)).toBeNull();
  });

  it("shortens a very long line", () => {
    expect(entrySummary({ text: "x".repeat(300) }, message)?.length).toBe(120);
  });
});
