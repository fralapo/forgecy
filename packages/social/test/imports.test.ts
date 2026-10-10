import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

// The web app bundles this package from source: Next cannot resolve "./x.js" to "./x.ts",
// which typecheck and vitest both accept. It only shows up in `next build`.
describe("source imports", () => {
  it("never name a .js file in a relative import", () => {
    const offenders = sources(join(__dirname, "../src")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /from\s+["']\.{1,2}\/[^"']*\.js["']/.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps Playwright out of the web entry", () => {
    // Only the driver imports it, and only the worker handlers load the driver, dynamically.
    const files = sources(join(__dirname, "../src")).map((file) => ({
      file,
      text: readFileSync(file, "utf8"),
    }));
    const importsPlaywright = files.filter((f) => /from\s+["']playwright-core["']/.test(f.text));
    expect(importsPlaywright.map((f) => basename(f.file))).toEqual(["public-browser-driver.ts"]);
    const loadsDriver = files.filter((f) => f.text.includes("public-browser-driver"));
    expect(loadsDriver.map((f) => basename(f.file))).toEqual(["handlers.ts"]);
    expect(loadsDriver.every((f) => !/^import .*public-browser-driver/m.test(f.text))).toBe(true);
  });

  it("passes page.evaluate only strings, never functions", () => {
    // A function is serialised with toString(); transpilers (tsx runs the worker) wrap nested
    // functions in helpers that do not exist in the page ("readMetas is not defined" in a real run).
    const text = readFileSync(join(__dirname, "../src/sources/public-browser-driver.ts"), "utf8");
    const calls = [...text.matchAll(/page\.evaluate[^(]*\(\s*([A-Za-z_]+)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const arg of calls) expect(arg).toMatch(/^[A-Z][A-Z_]+$/);
  });
});
