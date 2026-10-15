import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCatalogPrices } from "../../scripts/evaluate-catalog-prices";

test("public catalog price benchmark distinguishes correct prices from OCR code errors", () => {
  const result = evaluateCatalogPrices();
  assert.equal(result.total, 10);
  assert.equal(result.rowMatches, 10);
  assert.equal(result.correctPrices, 10);
  assert.equal(result.exactCodes, 6);
  assert.equal(result.failures.filter((failure) => failure.reason === "codice estratto non esatto").length, 4);
});
