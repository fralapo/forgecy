import { describe, expect, it } from "vitest";
import { newestVisibleVersion } from "../src/client-book";

const rows = [
  { version: "1.0.0", clientId: null },
  { version: "1.2.0", clientId: null },
  { version: "2.0.0", clientId: "c-other" },
  { version: "1.5.0", clientId: "c-mine" },
];

describe("newestVisibleVersion", () => {
  it("pins the newest agency or own Brand Book template, not another client's", () => {
    expect(newestVisibleVersion(rows, "c-mine")).toBe("1.5.0");
    expect(newestVisibleVersion(rows, "c-third")).toBe("1.2.0");
    expect(newestVisibleVersion(rows, "c-other")).toBe("2.0.0");
  });
  it("is null when only another client has one", () => {
    expect(newestVisibleVersion([{ version: "2.0.0", clientId: "c-other" }], "c-mine")).toBeNull();
    expect(newestVisibleVersion([], "c-mine")).toBeNull();
  });
  it("orders a renamed import below its release", () => {
    expect(
      newestVisibleVersion(
        [
          { version: "1.0.0", clientId: null },
          { version: "1.0.0-import.1", clientId: "c-mine" },
        ],
        "c-mine",
      ),
    ).toBe("1.0.0");
  });
});
