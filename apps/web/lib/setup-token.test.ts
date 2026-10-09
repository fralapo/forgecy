import { describe, expect, it } from "vitest";
import { setupTokenOk } from "./setup-token";

describe("setupTokenOk", () => {
  it("lets everyone through when no token is configured", () => {
    expect(setupTokenOk(undefined, "")).toBe(true);
    expect(setupTokenOk(undefined, "anything")).toBe(true);
  });
  it("requires the exact token when one is configured", () => {
    const token = "t".repeat(16) + "-secret";
    expect(setupTokenOk(token, token)).toBe(true);
    expect(setupTokenOk(token, "")).toBe(false);
    expect(setupTokenOk(token, token + " ")).toBe(false);
    expect(setupTokenOk(token, token.toUpperCase())).toBe(false);
  });
  it("does not throw on inputs of different length", () => {
    expect(() => setupTokenOk("a".repeat(20), "b")).not.toThrow();
    expect(setupTokenOk("a".repeat(20), "b")).toBe(false);
  });
});
