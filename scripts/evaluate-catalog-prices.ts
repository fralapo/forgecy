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
  rowMatches: number;
  correctPrices: number;
  exactCodes: number;
  failures: Array<{ code: string; source: string; reason: string }>;
};

const groundTruth = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/catalog-price-groundtruth.json"), "utf8")) as GroundTruth[];

export function evaluateCatalogPrices(): CatalogPriceEvaluation {
  const fixtureProducts = new Map<string, ReturnType<typeof parseLocalCatalogProducts>>();
  const failures: CatalogPriceEvaluation["failures"] = [];
  let rowMatches = 0;
  let correctPrices = 0;
  let exactCodes = 0;

  for (const expected of groundTruth) {
    let products = fixtureProducts.get(expected.fixture);
    if (!products) {
      const text = readFileSync(join(process.cwd(), "tests/fixtures", expected.fixture), "utf8");
      products = parseLocalCatalogProducts(expected.fixture, text);
      fixtureProducts.set(expected.fixture, products);
    }

    const match = products.find((product) => product.name.includes(expected.family)
      && product.name.includes(`— ${expected.variant}`));
    if (!match) {
      failures.push({ code: expected.code, source: expected.source, reason: "variante non trovata" });
      continue;
    }
    rowMatches += 1;
    if (match.price === expected.price) correctPrices += 1;
    else failures.push({ code: expected.code, source: expected.source, reason: `prezzo atteso ${expected.price}, trovato ${match.price ?? "vuoto"}` });

    const normalizedExpected = expected.code.replace(/\s+/gu, "").toUpperCase();
    const normalizedActual = match.name.replace(/\s+/gu, "").toUpperCase();
    if (normalizedActual.includes(normalizedExpected)) exactCodes += 1;
    else failures.push({ code: expected.code, source: expected.source, reason: "codice estratto non esatto" });
  }

  return { total: groundTruth.length, rowMatches, correctPrices, exactCodes, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = evaluateCatalogPrices();
  console.log(JSON.stringify(result, null, 2));
  if (result.correctPrices !== result.total || result.rowMatches !== result.total) process.exitCode = 1;
}
