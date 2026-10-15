import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCatalogPrices } from "../../scripts/evaluate-catalog-prices";

test("public catalog price benchmark distinguishes correct prices from OCR code errors", () => {
  const result = evaluateCatalogPrices();
  assert.equal(result.total, 51);
  assert.equal(result.uniquePriceCells, 44);
  assert.equal(result.rowMatches, 51);
  assert.equal(result.correctPrices, 51);
  assert.equal(result.exactCodes, 47);
  assert.deepEqual(result.byFixture["stanley-2026-page-54-native.txt"], {
    total: 7, rowMatches: 7, correctPrices: 7, exactCodes: 7,
  });
  assert.deepEqual(result.byFixture["stanley-2026-page-54-ocr.md"], {
    total: 7, rowMatches: 7, correctPrices: 7, exactCodes: 3,
  });
  assert.deepEqual(result.byFixture["conex-series-8000-page-188-ocr.md"], {
    total: 23, rowMatches: 23, correctPrices: 23, exactCodes: 23,
  });
  assert.deepEqual(result.byFixture["sicutool-2025-page-1108-native.txt"], {
    total: 9, rowMatches: 9, correctPrices: 9, exactCodes: 9,
  });
  assert.deepEqual(result.byFixture["vaillant-price-2026-page-2-native.txt"], {
    total: 5, rowMatches: 5, correctPrices: 5, exactCodes: 5,
  });
  assert.equal(result.failures.filter((failure) => failure.reason === "codice estratto non esatto").length, 4);
});
