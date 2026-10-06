import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { DesignPage } from "../src/design-page";

describe("DesignPage", () => {
  it("renders as a plain function (server-component safe, no hooks)", () => {
    expect(isValidElement(DesignPage({}))).toBe(true);
  });
});
