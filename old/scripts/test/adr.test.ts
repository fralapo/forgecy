import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { read, repoRoot } from "./helpers";

const dir = join(repoRoot, "docs/adr");
const files = readdirSync(dir)
  .filter((f) => /^\d{4}-.+\.md$/.test(f))
  .sort();
const numbers = files.map((f) => f.slice(0, 4));
/** Two ADRs were accepted as 0007 on 2026-10-06; links already use file names. Never add another. */
const LEGACY_DUPLICATES = new Set(["0007"]);

describe("ADR bookkeeping", () => {
  it("numbers are unique, apart from the one legacy duplicate", () => {
    const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i && !LEGACY_DUPLICATES.has(n));
    expect(dupes).toEqual([]);
    expect(numbers.filter((n) => n === "0007")).toHaveLength(2);
  });

  it("the numbering has no gaps", () => {
    const unique = [...new Set(numbers)].map(Number);
    expect(unique).toEqual(unique.map((_, i) => i + 1));
  });

  it.each(files)("%s has a status", (file) => {
    expect(read(`docs/adr/${file}`)).toMatch(/^- Status: (accepted|proposed|rejected|superseded)/m);
  });

  it.each(files)("%s: supersession points at existing ADRs", (file) => {
    const status = /^- Status: .*$/m.exec(read(`docs/adr/${file}`))?.[0] ?? "";
    const refs = [
      ...status.matchAll(/(?:superseded by|see)\s+((?:\d{4}(?:,\s*|\s+and\s+)?)+)/gi),
    ].flatMap((m) => m[1]!.match(/\d{4}/g) ?? []);
    for (const ref of refs) expect(numbers, `${file} -> ${ref}`).toContain(ref);
  });

  it("0006 and 0008 record what later ADRs changed", () => {
    expect(read("docs/adr/0006-deepseek-openrouter-images-no-chatgpt-login.md")).toMatch(
      /^- Status: .*superseded by 0012/m,
    );
    expect(read("docs/adr/0006-deepseek-openrouter-images-no-chatgpt-login.md")).toMatch(
      /^- Status: .*by 0016/m,
    );
    expect(read("docs/adr/0008-provider-and-model-choice-in-settings.md")).toMatch(
      /^- Status: .*superseded by 0016/m,
    );
  });

  it("both 0007 ADRs tell the reader to use the file name", () => {
    for (const f of files.filter((n) => n.startsWith("0007-")))
      expect(read(`docs/adr/${f}`), f).toMatch(/^- Note 2026-10-08: .*file name/m);
  });

  it("nothing refers to the ambiguous bare number 0007", () => {
    const docs = [
      "packages/ai/README.md",
      "docs/agents/README.md",
      "docs/ARCHITECTURE.md",
      "docs/I18N.md",
      "README.md",
    ];
    for (const doc of docs) expect(read(doc), doc).not.toMatch(/adr\/0007(?![-\w])/);
  });
});

describe("security checklist", () => {
  it("quotes only crawl messages that exist", () => {
    const en = JSON.parse(read("packages/i18n/messages/en/audit.json")) as {
      stored: { crawl: Record<string, string> };
    };
    const quoted = [...read("docs/SECURITY_CHECKLIST.md").matchAll(/audit\.stored\.crawl\.(\w+)/g)];
    expect(quoted.length).toBeGreaterThan(0);
    for (const [, key] of quoted) expect(Object.keys(en.stored.crawl), key).toContain(key);
  });

  it("does not quote the old, nonexistent SSRF message", () => {
    expect(read("docs/SECURITY_CHECKLIST.md")).not.toContain("address is local or private");
  });
});
