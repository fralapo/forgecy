import { describe, expect, it } from "vitest";
import * as ai from "../src/index";

describe("agent memory surface", () => {
  it("has no code path that lets an agent write a memory", () => {
    expect(Object.keys(ai)).not.toContain("recordAgentMemory");
  });
  it("keeps the human decisions", () => {
    for (const fn of ["addMemory", "approveMemory", "rejectMemory", "editMemory", "archiveMemory"])
      expect(typeof (ai as Record<string, unknown>)[fn]).toBe("function");
  });
});
