import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseLocalCatalogProducts } from "../lib/catalog-import";

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
  exactCodes: number;
  byFixture: Record<string, { total: number; rowMatches: number; correctPrices: number; exactCodes: number }>;
  failures: Array<{ code: string; source: string; reason: string }>;
};

const groundTruth = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/catalog-price-groundtruth.json"), "utf8")) as GroundTruth[];

export function evaluateCatalogPrices(): CatalogPriceEvaluation {
  const fixtureProducts = new Map<string, ReturnType<typeof parseLocalCatalogProducts>>();
  const failures: CatalogPriceEvaluation["failures"] = [];
  const byFixture: CatalogPriceEvaluation["byFixture"] = {};
  const uniqueCells = new Set<string>();
  let rowMatches = 0;
  let correctPrices = 0;
  let exactCodes = 0;

  for (const expected of groundTruth) {
    const fixtureStats = byFixture[expected.fixture] ??= { total: 0, rowMatches: 0, correctPrices: 0, exactCodes: 0 };
    fixtureStats.total += 1;
    uniqueCells.add(`${expected.url}|${expected.code.replace(/\s+/gu, "").toUpperCase()}`);
    let products = fixtureProducts.get(expected.fixture);
    if (!products) {
      const text = readFileSync(join(process.cwd(), "tests/fixtures", expected.fixture), "utf8");
      const title = expected.fixture === "stanley-2026-page-54-native.txt"
        ? "Stanley-listino-2026-page-54.pdf"
        : expected.fixture === "sicutool-2025-page-1108-native.txt"
          ? "Sicutool catalogo 2025 pagina 1108.pdf"
          : expected.fixture;
      products = parseLocalCatalogProducts(title, text);
      fixtureProducts.set(expected.fixture, products);
    }

    const variantMatches = (name: string) => name.includes(`— ${expected.variant}`)
      || name.endsWith(`(${expected.variant})`)
      || name === expected.variant;
    const match = products.find((product) => product.name.includes(expected.family) && variantMatches(product.name));
    if (!match) {
      failures.push({ code: expected.code, source: expected.source, reason: "variante non trovata" });
      continue;
    }
    rowMatches += 1;
    fixtureStats.rowMatches += 1;
    if (match.price === expected.price) {
      correctPrices += 1;
      fixtureStats.correctPrices += 1;
    }
    else failures.push({ code: expected.code, source: expected.source, reason: `prezzo atteso ${expected.price}, trovato ${match.price ?? "vuoto"}` });

    const normalizedExpected = expected.code.replace(/\s+/gu, "").toUpperCase();
    const normalizedActual = `${match.name} ${match.description}`.replace(/\s+/gu, "").toUpperCase();
    if (normalizedActual.includes(normalizedExpected)) {
      exactCodes += 1;
      fixtureStats.exactCodes += 1;
    }
    else failures.push({ code: expected.code, source: expected.source, reason: "codice estratto non esatto" });
  }

  return { total: groundTruth.length, uniquePriceCells: uniqueCells.size, rowMatches, correctPrices, exactCodes, byFixture, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = evaluateCatalogPrices();
  console.log(JSON.stringify(result, null, 2));
  if (result.correctPrices !== result.total || result.rowMatches !== result.total) process.exitCode = 1;
}
