import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCatalogPrices } from "../../scripts/evaluate-catalog-prices";

test("public catalog price benchmark distinguishes correct prices from OCR code errors", () => {
  const result = evaluateCatalogPrices();
  assert.equal(result.total, 17);
  assert.equal(result.uniquePriceCells, 10);
  assert.equal(result.rowMatches, 17);
  assert.equal(result.correctPrices, 17);
  assert.equal(result.exactCodes, 13);
  assert.deepEqual(result.byFixture["stanley-2026-page-54-native.txt"], {
    total: 7, rowMatches: 7, correctPrices: 7, exactCodes: 7,
  });
  assert.deepEqual(result.byFixture["stanley-2026-page-54-ocr.md"], {
    total: 7, rowMatches: 7, correctPrices: 7, exactCodes: 3,
  });
  assert.deepEqual(result.byFixture["conex-series-8000-page-188-ocr.md"], {
    total: 3, rowMatches: 3, correctPrices: 3, exactCodes: 3,
  });
  assert.equal(result.failures.filter((failure) => failure.reason === "codice estratto non esatto").length, 4);
});
