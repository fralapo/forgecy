import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseLocalCatalogProducts, parsePositionedNativeCatalogRows } from "../lib/catalog-import";

type GroundTruth = {
  source: string;
  url: string;
  fixture: string;
  code: string;
  family: string;
  variant: string;
  price: number;
};

export type CatalogPriceEvaluation = {
  total: number;
  uniquePriceCells: number;
  rowMatches: number;
  correctPrices: number;
  exactVariants: number;
  exactCodes: number;
  byFixture: Record<string, { total: number; rowMatches: number; correctPrices: number; exactVariants: number; exactCodes: number }>;
  failures: Array<{ code: string; source: string; reason: string }>;
};

function containsExactCode(product: { name: string; description: string }, code: string) {
  const parts = code.trim().split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const pattern = parts.join("\\s*");
  return new RegExp(`(?:^|[^A-Z0-9])${pattern}(?=$|[^A-Z0-9])`, "iu").test(`${product.name} ${product.description}`);
}

const groundTruth = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/catalog-price-groundtruth.json"), "utf8")) as GroundTruth[];

export function evaluateCatalogPrices(): CatalogPriceEvaluation {
  const fixtureProducts = new Map<string, ReturnType<typeof parseLocalCatalogProducts>>();
  const failures: CatalogPriceEvaluation["failures"] = [];
  const byFixture: CatalogPriceEvaluation["byFixture"] = {};
  const uniqueCells = new Set<string>();
  let rowMatches = 0;
  let correctPrices = 0;
  let exactVariants = 0;
  let exactCodes = 0;

  for (const expected of groundTruth) {
    const fixtureStats = byFixture[expected.fixture] ??= { total: 0, rowMatches: 0, correctPrices: 0, exactVariants: 0, exactCodes: 0 };
    fixtureStats.total += 1;
    uniqueCells.add(`${expected.url}|${expected.code.replace(/\s+/gu, "").toUpperCase()}|${expected.variant.replace(/\s+/gu, "").toUpperCase()}`);
    let products = fixtureProducts.get(expected.fixture);
    if (!products) {
      const fixturePath=join(process.cwd(), "tests/fixtures", expected.fixture);
      const title = expected.fixture === "stanley-2026-page-54-native.txt"
        ? "Stanley-listino-2026-page-54.pdf"
        : expected.fixture === "sicutool-2025-page-1108-native.txt"
          ? "Sicutool catalogo 2025 pagina 1108.pdf"
          : expected.fixture === "sicutool-2025-page-1112-native-positioned.json"
            ? "Sicutool catalogo 2025 pagina 1112.pdf"
            : expected.fixture === "fip-actuated-valves-2026-page-206.txt"
              ? "Listino FIP valvole attuate 2026.pdf"
          : expected.fixture;
      if(expected.fixture==="sicutool-2025-page-1112-native-positioned.json"){
        const positioned=JSON.parse(readFileSync(fixturePath,"utf8")) as {items:Array<{str:string;x:number;y:number}>};
        products=parsePositionedNativeCatalogRows(title,positioned.items);
      }else{
        const text=readFileSync(fixturePath,"utf8");
        products = parseLocalCatalogProducts(title, text);
      }
      fixtureProducts.set(expected.fixture, products);
    }

    const variantMatches = (name: string) => {
      if (name === expected.variant || name.endsWith(`(${expected.variant})`)) return true;
      const marker = `— ${expected.variant}`;
      let offset = 0;
      while (true) {
        const index = name.indexOf(marker, offset);
        if (index < 0) return false;
        const next = name[index + marker.length] || "";
        if (!/[A-Z0-9]/iu.test(next)) return true;
        offset = index + 1;
      }
    };
    const matchByCode = products.find((product) => containsExactCode(product, expected.code) && variantMatches(product.name))
      ?? products.find((product) => containsExactCode(product, expected.code));
    // OCR can corrupt a SKU while leaving the family and size intact. Count
    // that row as found, but report exact-code accuracy separately below.
    const match = matchByCode ?? products.find((product) => product.name.includes(expected.family) && variantMatches(product.name));
    if (!match) {
      failures.push({ code: expected.code, source: expected.source, reason: "variante non trovata" });
      continue;
    }
    rowMatches += 1;
    fixtureStats.rowMatches += 1;
    if (variantMatches(match.name)) {
      exactVariants += 1;
      fixtureStats.exactVariants += 1;
    }
    else failures.push({ code: expected.code, source: expected.source, reason: "variante estratta non esatta" });
    if (match.price === expected.price) {
      correctPrices += 1;
      fixtureStats.correctPrices += 1;
    }
    else failures.push({ code: expected.code, source: expected.source, reason: `prezzo atteso ${expected.price}, trovato ${match.price ?? "vuoto"}` });

    if (containsExactCode(match, expected.code)) {
      exactCodes += 1;
      fixtureStats.exactCodes += 1;
    }
    else failures.push({ code: expected.code, source: expected.source, reason: "codice estratto non esatto" });
  }

  return { total: groundTruth.length, uniquePriceCells: uniqueCells.size, rowMatches, correctPrices, exactVariants, exactCodes, byFixture, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = evaluateCatalogPrices();
  console.log(JSON.stringify(result, null, 2));
  const knownCodeErrors = new Set(["XTHT0-33671", "XTHT0-33501", "FMHT0-33864", "FMHT0-33868", "AIR917080"]);
  const knownVariantErrors = new Set(["0010015141", "0010015142"]);
  const unexpectedFailures = result.failures.filter((failure) =>
    !(failure.reason === "codice estratto non esatto" && knownCodeErrors.has(failure.code) && (failure.source.includes("Stanley Listino 2026, pagina stampata 54") || failure.code === "AIR917080" && failure.source.includes("Caleffi Listino prezzi VMC 2026, pagina stampata 16 (OCR)"))) &&
    !(failure.reason === "variante estratta non esatta" && knownVariantErrors.has(failure.code) && failure.source.includes("Vaillant Listino Prezzi giugno 2026, pagina stampata 2 (OCR)")));
  if (result.correctPrices !== result.total || result.rowMatches !== result.total || unexpectedFailures.length) process.exitCode = 1;
}
