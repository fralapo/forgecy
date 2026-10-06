import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { LOCALES } from "../src/locales";
import { loadMessages, loadRawMessages, withFallback, type MessageTree } from "../src/messages";

const root = new URL("../messages/", import.meta.url).pathname;

function flatten(tree: MessageTree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/** Argument names a message uses ({name}, {count, plural, ...}, <b>...</b>). */
function argumentsOf(elements: MessageFormatElement[], into = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (el.type === TYPE.literal || el.type === TYPE.pound) continue;
    into.add(el.value);
    if (el.type === TYPE.tag) argumentsOf(el.children, into);
    if (el.type === TYPE.plural || el.type === TYPE.select)
      for (const option of Object.values(el.options)) argumentsOf(option.value, into);
  }
  return into;
}

function pluralsWithoutOther(elements: MessageFormatElement[]): boolean {
  return elements.some(
    (el) =>
      ((el.type === TYPE.plural || el.type === TYPE.select) &&
        (!("other" in el.options) ||
          Object.values(el.options).some((o) => pluralsWithoutOther(o.value)))) ||
      (el.type === TYPE.tag && pluralsWithoutOther(el.children)),
  );
}

const english = flatten(await loadRawMessages("en"));

describe("message catalogs", () => {
  it("has one folder per supported language and nothing else", () => {
    const folders = readdirSync(root).filter((f) => statSync(join(root, f)).isDirectory());
    expect(folders.sort()).toEqual([...LOCALES].sort());
  });

  it.each(LOCALES)("%s: index.ts imports every namespace file", (locale) => {
    const dir = join(root, locale);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const index = readFileSync(join(dir, "index.ts"), "utf8");
    for (const file of files) expect(index, `${locale}/${file}`).toContain(`"./${file}"`);
    expect(files.sort()).toEqual(
      readdirSync(join(root, "en"))
        .filter((f) => f.endsWith(".json"))
        .sort(),
    );
  });

  it.each(LOCALES)("%s: has exactly the English keys", async (locale) => {
    const keys = [...flatten(await loadRawMessages(locale)).keys()];
    const missing = [...english.keys()].filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !english.has(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it.each(LOCALES)("%s: every message is valid ICU with the English arguments", async (locale) => {
    const problems: string[] = [];
    for (const [key, message] of flatten(await loadRawMessages(locale))) {
      try {
        const ast = parse(message);
        if (pluralsWithoutOther(ast)) problems.push(`${key}: plural/select without "other"`);
        const source = english.get(key);
        if (source === undefined) continue;
        const expected = [...argumentsOf(parse(source))].sort();
        const actual = [...argumentsOf(ast)].sort();
        if (expected.join() !== actual.join())
          problems.push(
            `${key}: arguments {${actual.join(", ")}}, English has {${expected.join(", ")}}`,
          );
      } catch (err) {
        problems.push(`${key}: ${(err as Error).message}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("fallback", () => {
  it("fills keys missing in a translation with English", () => {
    const merged = withFallback({ a: "A", b: { c: "C", d: "D" } }, { b: { c: "Ci" } });
    expect(merged).toEqual({ a: "A", b: { c: "Ci", d: "D" } });
  });

  it("loads Italian on top of English", async () => {
    const it = await loadMessages("it");
    expect(it.shell.signOut).toBe("Esci");
  });
});
