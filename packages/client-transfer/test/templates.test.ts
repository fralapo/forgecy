import { describe, expect, it } from "vitest";
import { freeImportVersion, reusableTemplates } from "../src/templates";

const rows = [
  { id: "agency", version: "1.0.0", client_id: null },
  { id: "mine", version: "1.1.0", client_id: "c-replaced" },
  { id: "theirs", version: "1.2.0", client_id: "c-other" },
];

describe("reusableTemplates", () => {
  it("offers agency templates only when the client is new", () => {
    expect(reusableTemplates(rows, null).map((r) => r.id)).toEqual(["agency"]);
  });
  it("adds the replaced client's own templates, never another client's", () => {
    expect(reusableTemplates(rows, "c-replaced").map((r) => r.id)).toEqual(["agency", "mine"]);
  });
});

describe("freeImportVersion", () => {
  it("keeps a version nobody holds", () => {
    expect(freeImportVersion("2.0.0", ["1.0.0"])).toBe("2.0.0");
  });
  it("renames a version that another client's private template already holds", () => {
    expect(freeImportVersion("1.2.0", ["1.2.0"])).toBe("1.2.0-import-1");
    expect(freeImportVersion("1.2.0", ["1.2.0", "1.2.0-import-1"])).toBe("1.2.0-import-2");
  });
});
