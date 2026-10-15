import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCatalogPrices } from "../../scripts/evaluate-catalog-prices";

test("public catalog price benchmark separates prices, OCR variants and exact codes", () => {
  const result = evaluateCatalogPrices();
  assert.equal(result.total, 388);
  assert.equal(result.uniquePriceCells, 238);
  assert.equal(result.rowMatches, 388);
  assert.equal(result.correctPrices, 388);
  assert.equal(result.exactVariants, 386);
  assert.equal(result.exactCodes, 383);
  assert.deepEqual(result.byFixture["stanley-2026-page-54-native.txt"], {
    total: 7, rowMatches: 7, correctPrices: 7, exactVariants: 7, exactCodes: 7,
  });
  assert.deepEqual(result.byFixture["stanley-2026-page-54-ocr.md"], {
    total: 7, rowMatches: 7, correctPrices: 7, exactVariants: 7, exactCodes: 3,
  });
  assert.deepEqual(result.byFixture["conex-series-8000-page-188-ocr.md"], {
    total: 23, rowMatches: 23, correctPrices: 23, exactVariants: 23, exactCodes: 23,
  });
  assert.deepEqual(result.byFixture["sicutool-2025-page-1108-native.txt"], {
    total: 9, rowMatches: 9, correctPrices: 9, exactVariants: 9, exactCodes: 9,
  });
  assert.deepEqual(result.byFixture["vaillant-price-2026-page-2-native.txt"], {
    total: 5, rowMatches: 5, correctPrices: 5, exactVariants: 5, exactCodes: 5,
  });
  assert.deepEqual(result.byFixture["vaillant-price-2026-page-2-ocr.md"], {
    total: 41, rowMatches: 41, correctPrices: 41, exactVariants: 39, exactCodes: 41,
  });
  assert.deepEqual(result.byFixture["vaillant-price-2026-page-3-native.txt"], {
    total: 41, rowMatches: 41, correctPrices: 41, exactVariants: 41, exactCodes: 41,
  });
  assert.deepEqual(result.byFixture["vaillant-price-2026-page-3-ocr.md"], {
    total: 41, rowMatches: 41, correctPrices: 41, exactVariants: 41, exactCodes: 41,
  });
  assert.deepEqual(result.byFixture["caleffi-vmc-2026-page-16-ocr.md"], {
    total: 8, rowMatches: 8, correctPrices: 8, exactVariants: 8, exactCodes: 7,
  });
  assert.deepEqual(result.byFixture["aco-r25-2026-page-2-native.txt"], {
    total: 5, rowMatches: 5, correctPrices: 5, exactVariants: 5, exactCodes: 5,
  });
  assert.deepEqual(result.byFixture["aco-r25-2026-page-2-ocr.md"], {
    total: 5, rowMatches: 5, correctPrices: 5, exactVariants: 5, exactCodes: 5,
  });
  assert.deepEqual(result.byFixture["aco-d25-2026-page-4-ocr.md"], {
    total: 12, rowMatches: 12, correctPrices: 12, exactVariants: 12, exactCodes: 12,
  });
  assert.deepEqual(result.byFixture["briani-listino-2026-page-1-native.txt"], {
    total: 92, rowMatches: 92, correctPrices: 92, exactVariants: 92, exactCodes: 92,
  });
  assert.deepEqual(result.byFixture["briani-listino-2026-page-1-ocr-full.md"], {
    total: 92, rowMatches: 92, correctPrices: 92, exactVariants: 92, exactCodes: 92,
  });
  assert.deepEqual(result.failures.map(({ code, reason }) => ({ code, reason })), [
    { code: "XTHT0-33671", reason: "codice estratto non esatto" },
    { code: "XTHT0-33501", reason: "codice estratto non esatto" },
    { code: "FMHT0-33864", reason: "codice estratto non esatto" },
    { code: "FMHT0-33868", reason: "codice estratto non esatto" },
    { code: "0010015141", reason: "variante estratta non esatta" },
    { code: "0010015142", reason: "variante estratta non esatta" },
    { code: "AIR917080", reason: "codice estratto non esatto" },
  ]);
});
