import { templateConflictId } from "@forgecy/core";
import { describe, expect, it } from "vitest";
import {
  freeImportVersion,
  planTemplateImport,
  referencesTemplate,
  renameTemplateRow,
  reusableTemplates,
  rewriteTemplateRefs,
  templateReuse,
} from "../src/templates";

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
  it("renames a taken version to a valid semver prerelease", () => {
    expect(freeImportVersion("1.2.0", ["1.2.0"])).toBe("1.2.0-import.1");
    expect(freeImportVersion("1.2.0", ["1.2.0", "1.2.0-import.1"])).toBe("1.2.0-import.2");
    expect(freeImportVersion("1.2.0", ["1.2.0"])).toMatch(
      /^\d+\.\d+\.\d+-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*$/,
    );
    expect(freeImportVersion("10.20.30", ["10.20.30"]).length).toBeLessThanOrEqual(20);
  });
});

describe("templateReuse is what Verify and Import both decide with", () => {
  const cases: { name: string; version: string; choice?: "useExisting" | "importDraft" }[] = [
    { name: "an agency version that is there", version: "1.0.0" },
    { name: "a version only another client holds", version: "1.2.0" },
    { name: "a version nobody holds", version: "3.0.0" },
    { name: "a version nobody holds, reuse chosen", version: "3.0.0", choice: "useExisting" },
    { name: "a version nobody holds, draft chosen", version: "3.0.0", choice: "importDraft" },
  ];
  for (const c of cases)
    it(`agrees in new mode for ${c.name}`, () => {
      // Verify never has a choice; Import has the person's. Both read the same owner (none).
      const verify = templateReuse(rows, c.version, null, undefined);
      const imported = templateReuse(rows, c.version, null, c.choice);
      expect(imported.conflictVersions).toEqual(verify.conflictVersions);
      // What Verify calls "reused" is exactly what Import reuses without being asked.
      expect(verify.kind === "exact").toBe(imported.kind === "exact");
      // Reuse of another version is only ever possible where Verify offered the choice.
      if (imported.kind === "useExisting")
        expect(verify.conflictVersions.length).toBeGreaterThan(0);
    });
  it("never offers another client's private template, in either mode", () => {
    for (const owner of [null, "c-replaced"]) {
      const r = templateReuse(rows, "1.2.0", owner, "useExisting");
      expect(r.kind === "useExisting" ? r.row.id : "").toBe("agency");
      expect(r.conflictVersions).not.toContain("1.2.0");
    }
  });
  it("reuses the replaced client's own template only for that client", () => {
    expect(templateReuse(rows, "1.1.0", "c-replaced", undefined).kind).toBe("exact");
    expect(templateReuse(rows, "1.1.0", null, undefined).kind).toBe("import");
  });
  it("renames an imported version that another client's template holds", () => {
    const r = templateReuse(rows, "1.2.0", null, undefined, ["1.2.0"]);
    expect(r).toMatchObject({ kind: "import", version: "1.2.0-import.1" });
    expect(templateReuse(rows, "3.0.0", null, undefined)).toMatchObject({
      kind: "import",
      version: "3.0.0",
    });
  });
  it("reuses the newest reusable version when asked to", () => {
    const r = templateReuse(
      [
        { id: "new", version: "1.5.0", client_id: null },
        { id: "old", version: "1.0.0", client_id: null },
      ],
      "2.0.0",
      null,
      "useExisting",
    );
    expect(r).toMatchObject({
      kind: "useExisting",
      row: { id: "new" },
      conflictVersions: ["1.5.0", "1.0.0"],
    });
  });
});

describe("rewriteTemplateRefs", () => {
  const rewrite = new Map([[templateConflictId("promo", "1.0.0"), "1.0.0-import.1"]]);
  /** One row of every kind of table that names a template by key and version. */
  const fixtures: [string, Record<string, unknown>][] = [
    ["contents", { id: "c", template_key: "promo", template_version: "1.0.0", brief: {} }],
    ["brand_book_exports", { id: "b", template_key: "promo", template_version: "1.0.0" }],
    [
      "content_versions",
      {
        id: "v",
        document: { templateKey: "promo" },
        meta: { templateKey: "promo", templateVersion: "1.0.0", models: [] },
      },
    ],
    [
      "automations",
      {
        id: "a",
        params: {
          templateKey: "promo",
          nested: [{ templateId: "promo", templateVersion: "1.0.0" }],
        },
      },
    ],
    [
      "content_versions (pipeline)",
      { id: "w", meta: { promptVersion: "p1", template: "promo", version: "1.0.0" } },
    ],
    [
      "content_plan_items",
      { id: "p", provenance: { template: { id: "promo", version: "1.0.0" } } },
    ],
  ];
  it("leaves no row of any table pointing at the renamed key and version", () => {
    for (const [, row] of fixtures) expect(referencesTemplate(row, "promo", "1.0.0")).toBe(true);
    for (const [table, row] of fixtures) {
      const out = rewriteTemplateRefs(row, rewrite);
      expect(referencesTemplate(out, "promo", "1.0.0"), table).toBe(false);
      expect(referencesTemplate(out, "promo", "1.0.0-import.1"), table).toBe(true);
    }
  });
  it("does not touch another template or another version", () => {
    const row = {
      template_key: "promo",
      template_version: "2.0.0",
      meta: { templateKey: "other", templateVersion: "1.0.0" },
    };
    expect(rewriteTemplateRefs(row, rewrite)).toEqual(row);
  });
  it("does not mutate its input", () => {
    const row = { meta: { templateKey: "promo", templateVersion: "1.0.0" } };
    rewriteTemplateRefs(row, rewrite);
    expect(row.meta.templateVersion).toBe("1.0.0");
  });
  it("follows a reuse of an existing version the same way", () => {
    const reuse = new Map([[templateConflictId("promo", "1.0.0"), "1.5.0"]]);
    const out = rewriteTemplateRefs(fixtures[2]![1], reuse);
    expect((out.meta as Record<string, unknown>).templateVersion).toBe("1.5.0");
  });
});

describe("renameTemplateRow", () => {
  it("changes the version of the row and nothing else, manifest included", () => {
    const row = {
      id: "t",
      key: "promo",
      version: "1.0.0",
      manifest: { id: "promo", version: "1.0.0" },
    };
    const out = renameTemplateRow(row, "1.0.0-import.1");
    expect(out).toEqual({ ...row, version: "1.0.0-import.1" });
    expect(row.version).toBe("1.0.0");
  });
});

describe("planTemplateImport reserves the names it hands out", () => {
  const pkg = (...versions: string[]) =>
    versions.map((version, i) => ({ id: `p${i}`, key: "promo", version }));
  const held = (...versions: string[]) =>
    new Map([
      ["promo", versions.map((version, i) => ({ id: `h${i}`, version, client_id: "c-other" }))],
    ]);
  const finalVersions = (plan: ReturnType<typeof planTemplateImport>) =>
    [...plan.values()].map((d) => (d.kind === "import" ? d.version : "(reused)"));

  it("does not give a renamed template the name of another template of the package", () => {
    const plan = planTemplateImport(pkg("1.0.0", "1.0.0-import.1"), held("1.0.0"), null, {});
    expect(finalVersions(plan)).toEqual(["1.0.0-import.2", "1.0.0-import.1"]);
  });
  it("keeps every final version distinct and free when several collide", () => {
    const plan = planTemplateImport(
      pkg("1.0.0", "1.0.0-import.1", "1.0.0-import.1-import.1"),
      held("1.0.0", "1.0.0-import.1"),
      null,
      {},
    );
    const finals = finalVersions(plan);
    expect(new Set(finals).size).toBe(finals.length);
    for (const v of finals) expect(["1.0.0", "1.0.0-import.1"]).not.toContain(v);
  });
  it("reuses what the person chose and what is exactly there", () => {
    const all = new Map([
      [
        "promo",
        [
          { id: "a", version: "1.0.0", client_id: null },
          { id: "b", version: "0.5.0", client_id: null },
        ],
      ],
    ]);
    const plan = planTemplateImport(pkg("1.0.0", "2.0.0"), all, null, {
      [templateConflictId("promo", "2.0.0")]: "useExisting",
    });
    expect([...plan.values()].map((d) => d.kind)).toEqual(["exact", "useExisting"]);
  });
});
