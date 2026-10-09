import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { jobs } from "../src/schema/jobs";

const root = fileURLToPath(new URL("../migrations/", import.meta.url));
const journal = JSON.parse(readFileSync(join(root, "meta/_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string; when: number }[];
};
const sqlTags = readdirSync(root)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.slice(0, -4))
  .sort();
const snapshotPrefixes = readdirSync(join(root, "meta"))
  .filter((f) => f.endsWith("_snapshot.json"))
  .map((f) => f.slice(0, 4))
  .sort();

describe("migrations", () => {
  it("journal, SQL files and snapshots list the same migrations", () => {
    const tags = journal.entries.map((e) => e.tag);
    expect([...tags].sort()).toEqual(sqlTags);
    expect(tags.map((t) => t.slice(0, 4)).sort()).toEqual(snapshotPrefixes);
  });

  it("numbers are unique and the journal is sequential and chronological", () => {
    const numbers = journal.entries.map((e) => e.tag.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
    journal.entries.forEach((e, i) => expect(e.idx).toBe(i));
    const whens = journal.entries.map((e) => e.when);
    expect(whens).toEqual([...whens].sort((a, b) => a - b));
  });
});

describe("jobs table", () => {
  it("has no unused dependency column", () => {
    expect(Object.keys(getTableColumns(jobs))).not.toContain("dependsOnJobId");
  });

  it("drops it through a generated migration", () => {
    const allSql = sqlTags.map((t) => readFileSync(join(root, `${t}.sql`), "utf8")).join("\n");
    expect(allSql).toMatch(/DROP COLUMN "depends_on_job_id"/);
  });
});
