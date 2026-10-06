import { describe, expect, it } from "vitest";
import { scanTemplateDir } from "../src/node";
import { formatIssue, validateTemplatePackage } from "../src/validate";
import { TEMPLATES, miniPackage } from "./helpers";

describe("validateTemplatePackage", () => {
  it("accepts every template shipped in templates/agency", async () => {
    const entries = await scanTemplateDir(TEMPLATES);
    expect(entries.map((e) => e.folder).sort()).toEqual([
      "editoriale-ig-4x5",
      "editoriale-linkedin",
      "report-audit-a4",
    ]);
    for (const e of entries) expect(e.report.issues.map(formatIssue), e.folder).toEqual([]);
  });

  it("ties kind and channel to the format: reports have no channel", () => {
    const report = (manifest: Record<string, unknown>) =>
      validateTemplatePackage(miniPackage({ manifest })).issues.map(formatIssue).join("\n");
    const a4 = { format: "report_a4", width: 1240, height: 1754 };
    expect(report({ ...a4, kind: "report", channel: undefined })).not.toMatch(/canale|kind/);
    expect(report({ ...a4, kind: "report" })).toContain("non ha un canale");
    expect(report({ ...a4, channel: undefined })).toContain('kind "report"');
    expect(report({ kind: "report" })).toContain('kind "carousel"');
    expect(report({ channel: undefined })).toContain("canale instagram");
    expect(report({ slides: { min: 1, max: 30, default: 2 } })).toContain("massimo ≤ 20");
    expect(
      report({
        ...a4,
        kind: "report",
        channel: undefined,
        slides: { min: 1, max: 40, default: 8 },
      }),
    ).not.toMatch(/pagine/);
  });

  it("reports hardcoded colors and off-scale sizes with file and line", () => {
    const report = validateTemplatePackage(
      miniPackage({
        css: `.box{\n  color: var(--fc-text);\n  background: #FF0000;\n  font-size: 37px;\n  border-color: rgb(0 0 0);\n}`,
      }),
    );
    const messages = report.issues.map(formatIssue);
    expect(messages).toContain(
      "`styles.css`, riga 3: colore `#FF0000` scritto a mano. Usa un ruolo colore (variabile CSS).",
    );
    expect(messages).toContain(
      "`styles.css`, riga 4: `font-size: 37px` fuori dalla scala tipografica.",
    );
    expect(messages.some((m) => m.includes("riga 5") && m.includes("rgb"))).toBe(true);
    expect(report.checks.find((c) => c.id === "hardcoded")?.status).toBe("error");
  });

  it("finds unmapped variables, missing fonts and missing assets", () => {
    const report = validateTemplatePackage(
      miniPackage({
        css: `.box{color:var(--fc-accent);font-family:"Playfair Display",serif;background:url(../assets/nope.png)}`,
      }),
    );
    const text = report.issues.map(formatIssue).join("\n");
    expect(text).toContain("`--fc-accent` non è legata");
    expect(text).toContain(`usa "Playfair Display" ma il font non è in \`fonts/\``);
    expect(report.issues.some((i) => i.code === "ASSET-MISSING")).toBe(true);
  });

  it("rejects scripts, handlers and external references in layouts", () => {
    const report = validateTemplatePackage(
      miniPackage({
        html: `<h1 data-slot="title" onclick="x()"></h1>\n<script>x()</script>\n<img src="https://cdn.example/x.png"><ul data-slot="items"><li></li></ul>`,
      }),
    );
    const text = report.issues.map(formatIssue).join("\n");
    expect(text).toContain("`layouts/only.html`, riga 1: attributo `onclick` non ammesso.");
    expect(text).toContain("riga 2: elemento `<script>` non ammesso");
    expect(text).toContain("riferimento esterno `https:`");
  });

  it("keeps HTML and metadata slots in sync", () => {
    const report = validateTemplatePackage(
      miniPackage({
        html: `<h1 data-slot="title"></h1><p data-slot="extra"></p><div data-slot="items"></div>`,
      }),
    );
    const text = report.issues.map(formatIssue).join("\n");
    expect(text).toContain(`lo slot "extra" è nell'HTML ma non in template.json`);
    expect(text).toContain(`lo slot elenco "items" deve essere`);
  });

  it("explains a broken template.json", () => {
    const files = miniPackage({
      manifest: { slides: { min: 5, max: 3, default: 4 }, format: "ig_1x1" },
    });
    const report = validateTemplatePackage(files);
    expect(report.ok).toBe(false);
    const text = report.issues.map((i) => i.message).join("\n");
    expect(text).toContain("minimo ≤ default ≤ massimo");
    expect(text).toContain("1080×1080");
  });
});
