import { describe, expect, it } from "vitest";
import { scanTemplateDir } from "../src/node";
import { formatIssue, validateTemplatePackage } from "../src/validate";
import { TEMPLATES, miniPackage } from "./helpers";

describe("validateTemplatePackage", () => {
  it("accepts every template shipped in templates", async () => {
    const entries = await scanTemplateDir(TEMPLATES);
    expect(entries.map((e) => e.folder).sort()).toEqual([
      "carousels/editorial-ig-4x5",
      "carousels/editorial-linkedin",
      "reports/report-audit-a4",
    ]);
    for (const e of entries) expect(e.report.issues.map(formatIssue), e.folder).toEqual([]);
  });

  it("ties kind and channel to the format: reports have no channel", () => {
    const report = (manifest: Record<string, unknown>) =>
      validateTemplatePackage(miniPackage({ manifest })).issues.map(formatIssue).join("\n");
    const a4 = { format: "report_a4", width: 1240, height: 1754 };
    expect(report({ ...a4, kind: "report", channel: undefined })).not.toMatch(/channel|kind/);
    expect(report({ ...a4, kind: "report" })).toContain("has no channel");
    expect(report({ ...a4, channel: undefined })).toContain('kind "report"');
    expect(report({ kind: "report" })).toContain('kind "carousel"');
    expect(report({ channel: undefined })).toContain("channel instagram");
    expect(report({ slides: { min: 1, max: 30, default: 2 } })).toContain("max ≤ 20");
    expect(
      report({
        ...a4,
        kind: "report",
        channel: undefined,
        slides: { min: 1, max: 40, default: 8 },
      }),
    ).not.toMatch(/pages/);
  });

  it("reports hardcoded colors and off-scale sizes with file and line", () => {
    const report = validateTemplatePackage(
      miniPackage({
        css: `.box{\n  color: var(--fc-text);\n  background: #FF0000;\n  font-size: 37px;\n  border-color: rgb(0 0 0);\n}`,
      }),
    );
    const messages = report.issues.map(formatIssue);
    expect(messages).toContain(
      "`styles.css`, line 3: hand-written color `#FF0000`. Use a color role (CSS variable).",
    );
    expect(messages).toContain("`styles.css`, line 4: `font-size: 37px` is off the type scale.");
    expect(messages.some((m) => m.includes("line 5") && m.includes("rgb"))).toBe(true);
    expect(report.checks.find((c) => c.id === "hardcoded")?.status).toBe("error");
  });

  it("finds unmapped variables, missing fonts and missing assets", () => {
    const report = validateTemplatePackage(
      miniPackage({
        css: `.box{color:var(--fc-accent);font-family:"Playfair Display",serif;background:url(../assets/nope.png)}`,
      }),
    );
    const text = report.issues.map(formatIssue).join("\n");
    expect(text).toContain("`--fc-accent` is not bound");
    expect(text).toContain(`uses "Playfair Display" but the font is not in \`fonts/\``);
    expect(report.issues.some((i) => i.code === "ASSET-MISSING")).toBe(true);
  });

  it("rejects scripts, handlers and external references in layouts", () => {
    const report = validateTemplatePackage(
      miniPackage({
        html: `<h1 data-slot="title" onclick="x()"></h1>\n<script>x()</script>\n<img src="https://cdn.example/x.png"><ul data-slot="items"><li></li></ul>`,
      }),
    );
    const text = report.issues.map(formatIssue).join("\n");
    expect(text).toContain("`layouts/only.html`, line 1: attribute `onclick` not allowed.");
    expect(text).toContain("line 2: element `<script>` not allowed");
    expect(text).toContain("external reference `https:`");
  });

  it("keeps HTML and metadata slots in sync", () => {
    const report = validateTemplatePackage(
      miniPackage({
        html: `<h1 data-slot="title"></h1><p data-slot="extra"></p><div data-slot="items"></div>`,
      }),
    );
    const text = report.issues.map(formatIssue).join("\n");
    expect(text).toContain(`slot "extra" is in the HTML but not in template.json`);
    expect(text).toContain(`list slot "items" must be`);
  });

  it("explains a broken template.json", () => {
    const files = miniPackage({
      manifest: { slides: { min: 5, max: 3, default: 4 }, format: "ig_1x1" },
    });
    const report = validateTemplatePackage(files);
    expect(report.ok).toBe(false);
    const text = report.issues.map((i) => i.message).join("\n");
    expect(text).toContain("min ≤ default ≤ max");
    expect(text).toContain("1080×1080");
  });
});
