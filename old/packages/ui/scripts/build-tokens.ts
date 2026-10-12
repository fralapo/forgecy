// Regenerates src/generated/tokens.css from tokens/forgecy.tokens.json.
// Usage: pnpm --filter @forgecy/ui tokens   (add --check to fail when the file is stale)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTokensCss, evaluateBrandGuard, formatRatio, type TokenTree } from "../src/tokens";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "tokens/forgecy.tokens.json");
const target = resolve(root, "src/generated/tokens.css");

const tree = JSON.parse(readFileSync(source, "utf8")) as TokenTree;

const failures = evaluateBrandGuard(tree).filter((r) => !r.pass);
if (failures.length > 0) {
  for (const f of failures) {
    console.error(
      `[brand-guard] ${f.theme} ${f.label}: ${f.fgHex} on ${f.bgHex} = ${formatRatio(f.ratio)} (min ${f.min}:1)`,
    );
  }
  process.exit(1);
}

const css = buildTokensCss(tree);
let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {
  // first run
}

if (process.argv.includes("--check")) {
  if (current !== css) {
    console.error("tokens.css is stale: run `pnpm tokens`");
    process.exit(1);
  }
  console.log("tokens.css is up to date");
} else if (current === css) {
  console.log("tokens.css unchanged");
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, css);
  console.log(`wrote ${target}`);
}
